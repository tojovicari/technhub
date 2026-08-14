import {
  ProviderIntegrationRepository,
  type IntegrationSummary,
} from '../integrations/repositories/provider-integration.repository';
import { WorkItemRepository } from '../integrations/repositories/work-item.repository';
import type { PersistedWorkItem } from '../integrations/repositories/work-item.repository';
import { WorkItemStatusTransitionRepository } from '../integrations/repositories/work-item-status-transition.repository';
import { DeploymentRepository } from '../integrations/repositories/deployment.repository';
import type { PersistedDeployment } from '../integrations/repositories/deployment.repository';
import { IncidentRepository } from '../integrations/repositories/incident.repository';
import type { PersistedIncident } from '../integrations/repositories/incident.repository';
import type { CanonicalWorkItemStatusTransition, IssueTrackerProvider } from '../integrations/core/canonical.types';
import { MappingRulesRepository } from './mapping-rules.repository';
import {
  TeamResourceLinkRepository,
  type ExternalResourceProvider,
  type ExternalResourceType,
} from '../identity/team-resource-link.repository';
import { EnrichedWorkItemRepository } from './enriched-work-item.repository';
import { EnrichedDeploymentRepository } from './enriched-deployment.repository';
import { EnrichedIncidentRepository } from './enriched-incident.repository';
import { IntegrationRunHistoryRepository } from '../integrations/repositories/integration-run-history.repository';
import {
  evaluateDeploymentEnvironment,
  evaluateIncidentSeverity,
  evaluateWorkItemLifecycle,
  evaluateWorkItemType,
  evaluateWorkflowState,
} from './rule-evaluator';
import type { EffectiveRules, EnrichedDeployment, EnrichedIncident, EnrichedWorkItem } from './domain-context.types';

export interface EnrichmentSummary {
  readonly processedCount: number;
  /** Contagem por classificação de saída — chaves variam por categoria (ex: 'BUG', 'PRODUCTION', 'COUNTS_AS_FAILURE'). */
  readonly breakdown: Readonly<Record<string, number>>;
}

/**
 * `no_integration`: nenhuma integração com esse `id` encontrada pra esse tenant.
 * `no_team`: só se aplica a `cicd` (GitHub Actions) hoje — integração existe,
 * mas nunca foi associada a um `teamId` (ver `PATCH .../integrations/:integrationId`).
 * Não se aplica a incidentes (ver `runIncidentEnrichment`) nem a work items
 * (ver `runWorkItemEnrichment`) — ambos resolvem time por registro, com
 * `teamId: null` quando nada resolve, em vez de recusar o lote inteiro.
 * `unsupported_category`: categoria do provider ainda sem Enriched Layer
 * (ex: `vcs`, `communication`).
 */
export type EnrichmentResult =
  | { readonly outcome: 'no_integration' }
  | { readonly outcome: 'no_team' }
  | { readonly outcome: 'unsupported_category' }
  | { readonly outcome: 'success'; readonly summary: EnrichmentSummary };

function countBy<T extends string>(values: readonly T[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

/**
 * Motor de transformação da Enriched Layer (Seção 3 e 5 da spec) — separado
 * do `SyncOrchestrator` de propósito: "o conector só faz a ingestão, o
 * motor de transformação só aplica regras de negócio" (CLAUDE.md).
 *
 * `runForIntegration` despacha pela categoria da integração
 * (`ProviderIntegrationRepository.getById`), já que cada categoria
 * enriquece um tipo de dado canônico diferente (work item, deploy,
 * incidente), com regras e resolução de time distintas entre si. Roda por
 * integração (não por provider) porque um tenant pode ter mais de uma
 * integração do mesmo provider (ex: dois boards Jira, cada um com seu
 * próprio time) — ver `provider_integration_id` em `canonical_work_items`/
 * `canonical_deployments`.
 */
export class EnrichmentService {
  constructor(
    private readonly integrationRepository: ProviderIntegrationRepository = new ProviderIntegrationRepository(),
    private readonly workItemRepository: WorkItemRepository = new WorkItemRepository(),
    private readonly workItemStatusTransitionRepository: WorkItemStatusTransitionRepository = new WorkItemStatusTransitionRepository(),
    private readonly deploymentRepository: DeploymentRepository = new DeploymentRepository(),
    private readonly incidentRepository: IncidentRepository = new IncidentRepository(),
    private readonly mappingRulesRepository: MappingRulesRepository = new MappingRulesRepository(),
    private readonly enrichedWorkItemRepository: EnrichedWorkItemRepository = new EnrichedWorkItemRepository(),
    private readonly enrichedDeploymentRepository: EnrichedDeploymentRepository = new EnrichedDeploymentRepository(),
    private readonly enrichedIncidentRepository: EnrichedIncidentRepository = new EnrichedIncidentRepository(),
    private readonly teamResourceLinkRepository: TeamResourceLinkRepository = new TeamResourceLinkRepository(),
    private readonly integrationRunHistoryRepository: IntegrationRunHistoryRepository = new IntegrationRunHistoryRepository(),
  ) {}

  async runForIntegration(tenantId: string, integrationId: string): Promise<EnrichmentResult> {
    const integration = await this.integrationRepository.getById(tenantId, integrationId);
    if (!integration) {
      return { outcome: 'no_integration' };
    }

    const startedAt = new Date();
    let result: EnrichmentResult;
    switch (integration.category) {
      case 'issue_tracker':
        result = await this.runWorkItemEnrichment(tenantId, integration);
        break;
      case 'cicd':
        result = await this.runDeploymentEnrichment(tenantId, integration);
        break;
      case 'incident':
        result = await this.runIncidentEnrichment(tenantId, integration);
        break;
      default:
        result = { outcome: 'unsupported_category' };
    }

    await this.integrationRunHistoryRepository.record(tenantId, {
      integrationId,
      runType: 'enrichment',
      triggeredBy: 'manual',
      success: result.outcome === 'success',
      summary: result.outcome === 'success' ? result.summary : undefined,
      errorMessage: result.outcome === 'success' ? null : result.outcome,
      startedAt,
      finishedAt: new Date(),
    });

    return result;
  }

  /**
   * Sem gate `no_team`: Jira/Linear não exigem mais `projectKey`/`teamKey`
   * na integração (rodada de vínculo pós-sync) — uma integração pode
   * sincronizar o site/workspace inteiro, sem `teamId` nenhum.
   *
   * Resolução de time por work item (não mais só pela integração inteira):
   * cada item pode ter seu próprio `externalGroupKey` (projeto no Jira, time
   * no Linear), e um admin pode vincular esse grupo externo a um time da
   * plataforma (`team_resource_links`, ver `POST /teams/:teamId/resource-links`,
   * `resourceType` `jira_project`/`linear_team`). O time de cada item é então
   * `mapa[externalGroupKey] ?? integration.teamId ?? null` — só cai no
   * `teamId` da integração (modo legado, com `projectKey`/`teamKey`
   * configurado) ou em `null` se aquele grupo nunca foi vinculado. Mesmo
   * formato de `runIncidentEnrichment`.
   */
  private async runWorkItemEnrichment(
    tenantId: string,
    integration: IntegrationSummary,
  ): Promise<EnrichmentResult> {
    const fallbackTeamId = integration.teamId ?? null;
    const groupResource = this.resolveGroupResource(integration.provider);

    const [workItems, externalGroupMap, transitions] = await Promise.all([
      this.workItemRepository.findByIntegration(tenantId, integration.id),
      groupResource
        ? this.teamResourceLinkRepository.findMapByProviderAndType(tenantId, groupResource.provider, groupResource.resourceType)
        : Promise.resolve(new Map<string, string>()),
      this.workItemStatusTransitionRepository.findByIntegration(
        tenantId,
        integration.id,
        integration.provider as IssueTrackerProvider,
      ),
    ]);

    const transitionsByExternalId = new Map<string, CanonicalWorkItemStatusTransition[]>();
    for (const transition of transitions) {
      const existing = transitionsByExternalId.get(transition.workItemExternalId);
      if (existing) {
        existing.push(transition);
      } else {
        transitionsByExternalId.set(transition.workItemExternalId, [transition]);
      }
    }

    const resolvedTeamIds = workItems.map(
      (item) => externalGroupMap.get(item.externalGroupKey ?? '') ?? fallbackTeamId,
    );

    const distinctTeamIds = [...new Set(resolvedTeamIds)];
    const effectiveRulesByTeamId = new Map(
      await Promise.all(
        distinctTeamIds.map(
          async (teamId) => [teamId, await this.mappingRulesRepository.getEffectiveRules(tenantId, teamId)] as const,
        ),
      ),
    );

    const enrichedItems = workItems.map((item, index) => {
      const resolvedTeamId = resolvedTeamIds[index];
      const effectiveRules = effectiveRulesByTeamId.get(resolvedTeamId);
      if (!effectiveRules) {
        // Inalcançável: `resolvedTeamId` vem de `resolvedTeamIds`, cujos valores distintos
        // são exatamente as chaves usadas para popular `effectiveRulesByTeamId`.
        throw new Error(`[enrichment] Regras não resolvidas para o time "${resolvedTeamId}".`);
      }
      return this.enrichWorkItem(
        item,
        resolvedTeamId,
        effectiveRules,
        transitionsByExternalId.get(item.externalId) ?? [],
      );
    });
    await this.enrichedWorkItemRepository.upsertMany(enrichedItems);

    return {
      outcome: 'success',
      summary: {
        processedCount: enrichedItems.length,
        breakdown: countBy(enrichedItems.map((item) => item.semanticCategory)),
      },
    };
  }

  /** `null` pra providers de issue tracker sem vínculo pós-sync suportado ainda. */
  private resolveGroupResource(
    provider: string,
  ): { readonly provider: ExternalResourceProvider; readonly resourceType: ExternalResourceType } | null {
    if (provider === 'jira') return { provider: 'jira', resourceType: 'jira_project' };
    if (provider === 'linear') return { provider: 'linear', resourceType: 'linear_team' };
    if (provider === 'azure_boards') return { provider: 'azure_boards', resourceType: 'azure_boards_project' };
    return null;
  }

  /**
   * GitHub Actions reaproveita o mesmo par `(github, github_repository)` já
   * usado pro vínculo de PRs (`resolveGroupResource` não existe pro lado de
   * deployment, mas o `resourceType` é o mesmo) — um repositório já
   * vinculado pra PRs resolve deployment também, sem vincular de novo.
   * `integration.teamId` continua servindo de fallback pra integrações cujo
   * repo ainda não foi vinculado via `team_resource_links`.
   */
  private resolveDeploymentGroupResource(
    provider: string,
  ): { readonly provider: ExternalResourceProvider; readonly resourceType: ExternalResourceType } | null {
    if (provider === 'argocd') return { provider: 'argocd', resourceType: 'argocd_project' };
    if (provider === 'github_actions') return { provider: 'github', resourceType: 'github_repository' };
    if (provider === 'azure_pipelines') return { provider: 'azure_pipelines', resourceType: 'azure_pipelines_project' };
    return null;
  }

  /**
   * Sem gate `no_team` fixo: o ArgoCD não segue o modelo "1 integração = 1
   * time" (mesma decisão já tomada pro Waroom/incidentes) — cada deployment
   * pode ter seu próprio `externalGroupKey` (projeto do ArgoCD), resolvido
   * via `team_resource_links`. GitHub Actions continua no modelo simples:
   * `resolveDeploymentGroupResource` devolve `null` pra ele, então
   * `externalGroupMap` fica vazio e todo deployment cai direto no
   * `fallbackTeamId` (`integration.teamId`) — comportamento idêntico a hoje.
   *
   * Agrega por provider (não só a integração que disparou o
   * enriquecimento), mesmo racional de `runIncidentEnrichment`: se o tenant
   * tiver mais de uma integração do mesmo provider, resolução de time já é
   * por registro, processar tudo de uma vez é seguro e idempotente.
   */
  private async runDeploymentEnrichment(
    tenantId: string,
    integration: IntegrationSummary,
  ): Promise<EnrichmentResult> {
    const fallbackTeamId = integration.teamId ?? null;
    const groupResource = this.resolveDeploymentGroupResource(integration.provider);

    if (!groupResource && !fallbackTeamId) {
      return { outcome: 'no_team' };
    }

    const [deployments, externalGroupMap] = await Promise.all([
      this.deploymentRepository.findByProvider(tenantId, integration.provider),
      groupResource
        ? this.teamResourceLinkRepository.findMapByProviderAndType(tenantId, groupResource.provider, groupResource.resourceType)
        : Promise.resolve(new Map<string, string>()),
    ]);

    const resolvedTeamIds = deployments.map(
      (deployment) => externalGroupMap.get(deployment.externalGroupKey ?? '') ?? fallbackTeamId,
    );

    const distinctTeamIds = [...new Set(resolvedTeamIds)];
    const effectiveRulesByTeamId = new Map(
      await Promise.all(
        distinctTeamIds.map(
          async (teamId) => [teamId, await this.mappingRulesRepository.getEffectiveRules(tenantId, teamId)] as const,
        ),
      ),
    );

    const enrichedDeployments = deployments.map((deployment, index) => {
      const resolvedTeamId = resolvedTeamIds[index];
      const effectiveRules = effectiveRulesByTeamId.get(resolvedTeamId);
      if (!effectiveRules) {
        // Inalcançável: `resolvedTeamId` vem de `resolvedTeamIds`, cujos valores distintos
        // são exatamente as chaves usadas para popular `effectiveRulesByTeamId`.
        throw new Error(`[enrichment] Regras não resolvidas para o time "${resolvedTeamId}".`);
      }
      return this.enrichDeployment(deployment, resolvedTeamId, effectiveRules);
    });
    await this.enrichedDeploymentRepository.upsertMany(enrichedDeployments);

    return {
      outcome: 'success',
      summary: {
        processedCount: enrichedDeployments.length,
        breakdown: countBy(enrichedDeployments.map((deployment) => deployment.semanticEnvironment)),
      },
    };
  }

  /**
   * Sem gate `no_team`: o Waroom não segue o modelo "1 integração = 1 time"
   * (decisão de uma rodada anterior) — `integration.teamId` fica nulo na
   * maioria dos casos.
   *
   * Resolução de time por incidente (não mais por integração inteira): cada
   * incidente pode ter seu próprio `externalTeamId` (resolvido pelo
   * `waroom.provider.ts` via service→team), e um admin pode vincular esse
   * time externo a um time da plataforma (`team_resource_links`, ver
   * `POST /teams/:teamId/resource-links`). O time de cada incidente é então
   * `mapa[externalTeamId] ?? integration.teamId ?? null` — só cai no
   * `teamId` da integração (ou `null`) se o time daquele incidente
   * específico nunca foi vinculado.
   *
   * Como incidentes no mesmo lote podem resolver pra times diferentes, e
   * cada time pode ter `mapping_rules` diferentes, `effectiveRules` não dá
   * mais pra resolver uma vez pro lote inteiro — resolve uma vez por time
   * distinto presente no lote.
   */
  private async runIncidentEnrichment(
    tenantId: string,
    integration: IntegrationSummary,
  ): Promise<EnrichmentResult> {
    const fallbackTeamId = integration.teamId ?? null;

    // Resolução por externalTeamId é específica do Waroom hoje — único
    // provider de incidente implementado. Agrega por provider (não só a
    // integração que disparou o enriquecimento): se o tenant tiver mais de
    // uma integração Waroom, resolução de time já é por registro
    // (team_resource_links), então processar tudo de uma vez é seguro e
    // idempotente.
    const [incidents, externalTeamMap] = await Promise.all([
      this.incidentRepository.findByProvider(tenantId, integration.provider),
      this.teamResourceLinkRepository.findMapByProviderAndType(tenantId, 'waroom', 'waroom_team'),
    ]);

    const resolvedTeamIds = incidents.map(
      (incident) => externalTeamMap.get(incident.externalTeamId ?? '') ?? fallbackTeamId,
    );

    const distinctTeamIds = [...new Set(resolvedTeamIds)];
    const effectiveRulesByTeamId = new Map(
      await Promise.all(
        distinctTeamIds.map(
          async (teamId) => [teamId, await this.mappingRulesRepository.getEffectiveRules(tenantId, teamId)] as const,
        ),
      ),
    );

    const enrichedIncidents = incidents.map((incident, index) => {
      const resolvedTeamId = resolvedTeamIds[index];
      const effectiveRules = effectiveRulesByTeamId.get(resolvedTeamId);
      if (!effectiveRules) {
        // Inalcançável: `resolvedTeamId` vem de `resolvedTeamIds`, cujos valores distintos
        // são exatamente as chaves usadas para popular `effectiveRulesByTeamId`.
        throw new Error(`[enrichment] Regras não resolvidas para o time "${resolvedTeamId}".`);
      }
      return this.enrichIncident(incident, resolvedTeamId, effectiveRules);
    });
    await this.enrichedIncidentRepository.upsertMany(enrichedIncidents);

    return {
      outcome: 'success',
      summary: {
        processedCount: enrichedIncidents.length,
        breakdown: countBy(enrichedIncidents.map((incident) => incident.failureClassification)),
      },
    };
  }

  private enrichWorkItem(
    item: PersistedWorkItem,
    teamId: string | null,
    effective: EffectiveRules,
    transitions: readonly CanonicalWorkItemStatusTransition[],
  ): EnrichedWorkItem {
    const semanticCategory = evaluateWorkItemType(item.rawIssueType, item.rawLabels, effective.rules);
    const { state, isActiveTime } = evaluateWorkflowState(item.rawStatus, effective.rules);
    const { startedWorkingAt, completedAt } = evaluateWorkItemLifecycle(
      transitions,
      item.rawStatus,
      item.createdAt,
      effective.rules,
    );

    return {
      id: item.id,
      tenantId: item.tenantId,
      teamId,
      semanticCategory,
      semanticState: state,
      isActiveWork: isActiveTime,
      startedWorkingAt,
      completedAt,
      processedAt: new Date(),
      appliedRuleVersion: effective.appliedRuleVersion,
    };
  }

  private enrichDeployment(
    deployment: PersistedDeployment,
    teamId: string | null,
    effective: EffectiveRules,
  ): EnrichedDeployment {
    return {
      id: deployment.id,
      tenantId: deployment.tenantId,
      teamId,
      semanticEnvironment: evaluateDeploymentEnvironment(deployment.environment, effective.rules),
      processedAt: new Date(),
      appliedRuleVersion: effective.appliedRuleVersion,
    };
  }

  private enrichIncident(
    incident: PersistedIncident,
    teamId: string | null,
    effective: EffectiveRules,
  ): EnrichedIncident {
    return {
      id: incident.id,
      tenantId: incident.tenantId,
      teamId,
      failureClassification: evaluateIncidentSeverity(incident.severity, effective.rules),
      processedAt: new Date(),
      appliedRuleVersion: effective.appliedRuleVersion,
    };
  }
}
