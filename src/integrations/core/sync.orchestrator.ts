import { ProviderFactory } from './provider.factory';
import { PullRequestRepository } from '../repositories/pull-request.repository';
import { WorkItemRepository } from '../repositories/work-item.repository';
import { IncidentRepository } from '../repositories/incident.repository';
import { DeploymentRepository } from '../repositories/deployment.repository';
import { DiscoveredIdentityRepository } from '../repositories/discovered-identity.repository';
import { WorkItemStatusTransitionRepository } from '../repositories/work-item-status-transition.repository';
import { IntegrationRunHistoryRepository } from '../repositories/integration-run-history.repository';
import { AlertRepository } from '../../alerts/alert.repository';
import type { SyncContext, SyncResult } from './canonical.types';

/** Quantas integrações `runBatch` processa em paralelo por vez — ver `runBatch`. */
const SYNC_BATCH_CONCURRENCY = 10;

/**
 * Orquestra a execução de sincronizações incrementais sobre os provedores
 * registrados em `ProviderFactory`, persistindo os lotes canônicos
 * retornados na Camada Canônica (PostgreSQL).
 *
 * É o único ponto do sistema que chama `BaseProvider.syncIncremental`
 * diretamente — jobs de cron/queue (Seção 1, Princípio 1: Batch First)
 * dependem apenas deste orquestrador, nunca de um conector específico.
 *
 * Nenhum erro de um provedor ou de persistência propaga como exceção: falhas
 * são convertidas em `SyncResult.success = false`, preservando a resiliência
 * em lote quando múltiplas integrações são processadas em sequência.
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 1, 5 e 7.
 */
export class SyncOrchestrator {
  constructor(
    private readonly pullRequestRepository: PullRequestRepository = new PullRequestRepository(),
    private readonly workItemRepository: WorkItemRepository = new WorkItemRepository(),
    private readonly incidentRepository: IncidentRepository = new IncidentRepository(),
    private readonly deploymentRepository: DeploymentRepository = new DeploymentRepository(),
    private readonly discoveredIdentityRepository: DiscoveredIdentityRepository = new DiscoveredIdentityRepository(),
    private readonly workItemStatusTransitionRepository: WorkItemStatusTransitionRepository = new WorkItemStatusTransitionRepository(),
    private readonly integrationRunHistoryRepository: IntegrationRunHistoryRepository = new IntegrationRunHistoryRepository(),
    private readonly alertRepository: AlertRepository = new AlertRepository(),
  ) {}

  /**
   * Executa a sincronização incremental de uma única integração
   * (tenant + time + provedor), resolvendo o conector via `ProviderFactory`
   * a partir de `context.providerName` e persistindo os registros retornados.
   *
   * Nunca lança: falhas de resolução do provedor, da sincronização ou da
   * persistência são capturadas e devolvidas como `SyncResult.success = false`.
   */
  async runSyncForIntegration(context: SyncContext): Promise<SyncResult> {
    const startedAt = performance.now();
    const startedAtDate = new Date();

    try {
      const provider = ProviderFactory.create(context.providerName);
      const knownExternalUserIds = await this.resolveKnownExternalUserIds(context);
      const syncResult = await provider.syncIncremental({ ...context, knownExternalUserIds });
      const result = await this.persist(syncResult, context.integrationId);

      this.logOutcome(context.providerName, result, performance.now() - startedAt);
      await this.integrationRunHistoryRepository.record(context.tenantId, {
        integrationId: context.integrationId,
        runType: 'sync',
        triggeredBy: context.triggeredBy ?? 'manual',
        success: result.success,
        summary: { fetchedCount: result.fetchedCount },
        errorMessage: result.errors?.join('; ') ?? null,
        startedAt: startedAtDate,
        finishedAt: new Date(),
      });
      await this.alertRepository.create(context.tenantId, {
        type: 'sync_run_finished',
        severity: result.success ? 'info' : 'warning',
        title: result.success ? 'Sincronização concluída' : 'Sincronização concluída com falhas',
        message: `Integração "${context.providerName}" ${result.success ? 'sincronizou com sucesso' : 'teve falhas ao sincronizar'} (${result.fetchedCount} registro(s)).`,
        integrationId: context.integrationId,
        metadata: {
          provider: context.providerName,
          success: result.success,
          fetchedCount: result.fetchedCount,
          errorMessage: result.errors?.join('; ') ?? null,
        },
      });
      return result;
    } catch (error) {
      const durationMs = performance.now() - startedAt;
      const message = this.describeError(error);

      console.error(
        `[SyncOrchestrator] Falha em "${context.providerName}" após ${durationMs.toFixed(0)}ms: ${message}`,
      );

      await this.integrationRunHistoryRepository.record(context.tenantId, {
        integrationId: context.integrationId,
        runType: 'sync',
        triggeredBy: context.triggeredBy ?? 'manual',
        success: false,
        errorMessage: message,
        startedAt: startedAtDate,
        finishedAt: new Date(),
      });
      await this.alertRepository.create(context.tenantId, {
        type: 'sync_run_finished',
        severity: 'warning',
        title: 'Sincronização falhou',
        message: `Integração "${context.providerName}" falhou ao sincronizar: ${message}`,
        integrationId: context.integrationId,
        metadata: { provider: context.providerName, success: false, fetchedCount: 0, errorMessage: message },
      });

      return {
        success: false,
        fetchedCount: 0,
        errors: [message],
      };
    }
  }

  /**
   * Executa `runSyncForIntegration` para múltiplas integrações, isolando a
   * falha de uma integração das demais (resiliência em lote).
   *
   * Em lotes de `SYNC_BATCH_CONCURRENCY`, não tudo de uma vez: cada integração
   * abre sua própria conexão de banco (`withTenantContext`) — sem limitar isso,
   * uma base com muitos tenants/integrações ativos satura o pool do Postgres
   * (ver `docs/BACKLOG.md`, item resolvido nesta rodada, e `DATABASE_POOL_MAX`
   * em `src/database/pool.ts`). A ordem dos resultados corresponde à ordem de
   * `contexts` mesmo em lotes.
   */
  async runBatch(contexts: readonly SyncContext[]): Promise<readonly SyncResult[]> {
    const results: SyncResult[] = [];

    for (let i = 0; i < contexts.length; i += SYNC_BATCH_CONCURRENCY) {
      const batch = contexts.slice(i, i + SYNC_BATCH_CONCURRENCY);
      const batchResults = await Promise.all(batch.map((context) => this.runSyncForIntegration(context)));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Carrega os `external_user_id`s já conhecidos (`discovered_identities`)
   * pra este tenant+provider, usados por conectores como o Jira pra só
   * resolver identidade de gente genuinamente nova (ver
   * `SyncContext.knownExternalUserIds`).
   *
   * Falha "soft": se a consulta der erro, loga e segue com um `Set` vazio —
   * pior caso é reprocessar alguém já conhecido, não abortar a sync inteira.
   */
  private async resolveKnownExternalUserIds(context: SyncContext): Promise<ReadonlySet<string>> {
    try {
      return await this.discoveredIdentityRepository.listExternalIdsByProvider(
        context.tenantId,
        context.providerName,
      );
    } catch (error) {
      console.error(
        `[SyncOrchestrator] Falha ao carregar identidades já conhecidas de "${context.providerName}": ${this.describeError(error)}. Prosseguindo com conjunto vazio.`,
      );
      return new Set();
    }
  }

  /**
   * Persiste os lotes canônicos de um `SyncResult` bem-sucedido através dos
   * repositórios correspondentes (cada provider só popula o(s) campo(s) da
   * sua própria categoria). Uma falha de persistência degrada o resultado
   * para `success = false`, preservando os dados já coletados (`fetchedCount`
   * e os próprios registros) para diagnóstico.
   */
  private async persist(result: SyncResult, providerIntegrationId: string): Promise<SyncResult> {
    if (!result.success) {
      return result;
    }

    const errors: string[] = [...(result.errors ?? [])];
    let degraded = false;

    if (result.pullRequests && result.pullRequests.length > 0) {
      try {
        await this.pullRequestRepository.upsertMany(result.pullRequests);
      } catch (error) {
        degraded = true;
        const message = `Falha ao persistir Pull Requests: ${this.describeError(error)}`;
        console.error(`[SyncOrchestrator] ${message}`);
        errors.push(message);
      }
    }

    if (result.workItems && result.workItems.length > 0) {
      try {
        await this.workItemRepository.upsertMany(result.workItems, providerIntegrationId);
      } catch (error) {
        degraded = true;
        const message = `Falha ao persistir Work Items: ${this.describeError(error)}`;
        console.error(`[SyncOrchestrator] ${message}`);
        errors.push(message);
      }
    }

    if (result.statusTransitions && result.statusTransitions.length > 0) {
      try {
        await this.workItemStatusTransitionRepository.upsertMany(result.statusTransitions, providerIntegrationId);
      } catch (error) {
        degraded = true;
        const message = `Falha ao persistir Transições de Status: ${this.describeError(error)}`;
        console.error(`[SyncOrchestrator] ${message}`);
        errors.push(message);
      }
    }

    if (result.incidents && result.incidents.length > 0) {
      try {
        await this.incidentRepository.upsertMany(result.incidents);
      } catch (error) {
        degraded = true;
        const message = `Falha ao persistir Incidentes: ${this.describeError(error)}`;
        console.error(`[SyncOrchestrator] ${message}`);
        errors.push(message);
      }
    }

    if (result.deployments && result.deployments.length > 0) {
      try {
        await this.deploymentRepository.upsertMany(result.deployments, providerIntegrationId);
      } catch (error) {
        degraded = true;
        const message = `Falha ao persistir Deploys: ${this.describeError(error)}`;
        console.error(`[SyncOrchestrator] ${message}`);
        errors.push(message);
      }
    }

    if (result.discoveredIdentities && result.discoveredIdentities.length > 0) {
      try {
        await this.discoveredIdentityRepository.upsertMany(result.discoveredIdentities);
      } catch (error) {
        degraded = true;
        const message = `Falha ao persistir Identidades Descobertas: ${this.describeError(error)}`;
        console.error(`[SyncOrchestrator] ${message}`);
        errors.push(message);
      }
    }

    return degraded ? { ...result, success: false, errors } : result;
  }

  private logOutcome(providerName: string, result: SyncResult, durationMs: number): void {
    const status = result.success ? 'concluído' : 'concluído com falhas';

    console.info(
      `[SyncOrchestrator] ${providerName} ${status} em ${durationMs.toFixed(0)}ms ` +
        `(fetched=${result.fetchedCount}, errors=${result.errors?.length ?? 0}).`,
    );
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
