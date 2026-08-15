import { TenantRepository } from '../identity/tenant.repository';
import { BillingService } from '../billing/billing.service';
import { AlertRepository } from '../alerts/alert.repository';
import { WorkItemRepository } from '../integrations/repositories/work-item.repository';
import { PullRequestRepository } from '../integrations/repositories/pull-request.repository';
import { IncidentRepository } from '../integrations/repositories/incident.repository';
import { DeploymentRepository } from '../integrations/repositories/deployment.repository';
import { WorkItemStatusTransitionRepository } from '../integrations/repositories/work-item-status-transition.repository';

/** Quantos registros um único `DELETE` apaga por vez — evita lock longo numa tabela grande, mesmo racional de `SYNC_BATCH_CONCURRENCY`. */
const PURGE_BATCH_SIZE = 1000;
/** Teto de iterações do loop `do/while` por tabela/tenant/execução — protege contra um primeiro expurgo caro num tenant com muito dado acumulado; o resto autocura nas próximas execuções (mesmo racional já usado em `MAX_DANGLING_PARENTS_PER_SYNC`, `sync.orchestrator.ts`). */
const MAX_PURGE_BATCHES_PER_TABLE = 500;
/** Quantos tenants `purgeAllTenants` processa em paralelo por vez. */
const RETENTION_BATCH_CONCURRENCY = 10;

/** Qualquer repositório canônico com suporte a expurgo por idade — os 5 repositórios injetados abaixo satisfazem isso estruturalmente. */
interface PurgeableRepository {
  purgeOlderThan(tenantId: string, cutoff: Date, batchSize: number): Promise<number>;
  existsOlderThan(tenantId: string, cutoff: Date): Promise<boolean>;
}

export interface RetentionPurgeResult {
  readonly tenantId: string;
  readonly purgedCount: number;
  readonly approachingAlert: boolean;
}

/**
 * Expurga dado canônico mais velho que a retenção do plano do tenant
 * (+ carência) — `BillingService.getDataRetentionPurgeCutoff`. Nunca
 * lança: falha num tenant não pode derrubar o expurgo dos demais, mesmo
 * espírito de `SyncOrchestrator`.
 *
 * `enriched_work_items`/`enriched_deployments`/`enriched_incidents` somem
 * sozinhos via `ON DELETE CASCADE` quando o canônico correspondente é
 * apagado — só `canonical_work_item_status_transitions` precisa de purge
 * explícito próprio (correlaciona por chave natural, sem FK, ver docstring
 * do repositório). `canonical_pull_requests` não tem contraparte
 * enriquecida (dashboards leem direto).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 4.4.
 */
export class RetentionPurgeService {
  private readonly repositories: readonly PurgeableRepository[];

  constructor(
    private readonly tenantRepository: TenantRepository = new TenantRepository(),
    private readonly billingService: BillingService = new BillingService(),
    private readonly alertRepository: AlertRepository = new AlertRepository(),
    workItemRepository: WorkItemRepository = new WorkItemRepository(),
    pullRequestRepository: PullRequestRepository = new PullRequestRepository(),
    incidentRepository: IncidentRepository = new IncidentRepository(),
    deploymentRepository: DeploymentRepository = new DeploymentRepository(),
    workItemStatusTransitionRepository: WorkItemStatusTransitionRepository = new WorkItemStatusTransitionRepository(),
  ) {
    this.repositories = [
      workItemRepository,
      pullRequestRepository,
      incidentRepository,
      deploymentRepository,
      workItemStatusTransitionRepository,
    ];
  }

  /**
   * Expurga um tenant só. `purgedCount: 0` sem `approachingAlert` também
   * cobre o caso comum de retenção ilimitada (plano sem teto configurado)
   * — nada a fazer, sem erro.
   */
  async purgeForTenant(tenantId: string): Promise<RetentionPurgeResult> {
    try {
      const purgeCutoff = await this.billingService.getDataRetentionPurgeCutoff(tenantId);
      if (!purgeCutoff) {
        return { tenantId, purgedCount: 0, approachingAlert: false };
      }

      let purgedCount = 0;
      for (const repository of this.repositories) {
        let deleted = 0;
        let batches = 0;
        do {
          deleted = await repository.purgeOlderThan(tenantId, purgeCutoff, PURGE_BATCH_SIZE);
          purgedCount += deleted;
          batches += 1;
        } while (deleted > 0 && batches < MAX_PURGE_BATCHES_PER_TABLE);
      }

      const warningCutoff = await this.billingService.getDataRetentionWarningCutoff(tenantId);
      const existenceChecks = warningCutoff
        ? await Promise.all(this.repositories.map((repository) => repository.existsOlderThan(tenantId, warningCutoff)))
        : [];
      const approachingAlert = existenceChecks.some(Boolean);

      await this.alertRepository.evaluateRetentionPurgeApproachingAlert(tenantId, approachingAlert);

      return { tenantId, purgedCount, approachingAlert };
    } catch (error) {
      console.error(
        `[RetentionPurgeService] Falha ao expurgar tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { tenantId, purgedCount: 0, approachingAlert: false };
    }
  }

  /** Expurga todos os tenants ativos, em lotes — mesmo padrão de `SyncOrchestrator.runBatch`. */
  async purgeAllTenants(): Promise<readonly RetentionPurgeResult[]> {
    const tenants = await this.tenantRepository.findAllActive();
    const results: RetentionPurgeResult[] = [];

    for (let i = 0; i < tenants.length; i += RETENTION_BATCH_CONCURRENCY) {
      const batch = tenants.slice(i, i + RETENTION_BATCH_CONCURRENCY);
      const batchResults = await Promise.all(batch.map((tenant) => this.purgeForTenant(tenant.id)));
      results.push(...batchResults);
    }

    return results;
  }
}
