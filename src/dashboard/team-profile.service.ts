import { getPool, withTenantContext } from '../database/pool';
import type { Pool } from 'pg';
import { TeamRepository } from '../identity/team.repository';
import { TeamMembershipRepository, type TeamMembershipWithUser } from '../identity/team-membership.repository';
import type { Team } from '../identity/identity.types';
import type { FlowDistributionEntry, UnavailableMetric } from './dashboard.service';
import { MappingRulesRepository } from '../enrichment/mapping-rules.repository';
import { evaluateWorkItemType, evaluateWorkflowState } from '../enrichment/rule-evaluator';

export interface DeploymentSuccessRateMetric {
  readonly available: true;
  readonly total: number;
  readonly success: number;
  readonly failure: number;
  readonly rate: number;
}

export interface PullRequestReviewHealthMetric {
  readonly available: true;
  readonly totalMerged: number;
  readonly mergedWithoutReview: number;
  readonly avgReviewers: number;
}

export interface ContributionConcentrationMetric {
  readonly available: true;
  readonly topContributorShare: number;
  readonly sampleSize: number;
}

export interface TeamProfile {
  readonly team: Team;
  readonly roster: readonly TeamMembershipWithUser[];
  readonly wip: { readonly count: number; readonly perMember: number | null };
  readonly distribution: readonly FlowDistributionEntry[];
  readonly incidentsBySeverity: readonly { readonly severity: string; readonly count: number }[];
  readonly deploymentSuccessRate: DeploymentSuccessRateMetric | UnavailableMetric;
  readonly pullRequestReviewHealth: PullRequestReviewHealthMetric | UnavailableMetric;
  readonly contributionConcentration: {
    readonly workItems: ContributionConcentrationMetric | UnavailableMetric;
    readonly pullRequests: ContributionConcentrationMetric | UnavailableMetric;
  };
}

const DEPLOYMENT_SUCCESS_RATE_UNAVAILABLE: UnavailableMetric = {
  available: false,
  reason: 'Nenhum deploy com status SUCCESS/FAILURE registrado pra este time ainda.',
};

const PR_REVIEW_HEALTH_UNAVAILABLE: UnavailableMetric = {
  available: false,
  reason: 'Nenhum PR mergeado de repositório vinculado a este time ainda.',
};

function workItemConcentrationUnavailable(): UnavailableMetric {
  return {
    available: false,
    reason: 'Nenhum work item com assignee resolvido pra este time ainda.',
  };
}

function pullRequestConcentrationUnavailable(): UnavailableMetric {
  return {
    available: false,
    reason: 'Nenhum PR mergeado com autor resolvido de repositório vinculado a este time ainda.',
  };
}

export interface TeamProfileHistoryPoint {
  readonly date: string;
  readonly wip: number;
  readonly distribution: readonly FlowDistributionEntry[];
}

export interface TeamProfileHistory {
  readonly points: readonly TeamProfileHistoryPoint[];
}

interface HistoryWorkItemRow {
  readonly provider_integration_id: string;
  readonly external_id: string;
  readonly created_at: Date;
  readonly raw_issue_type: string;
  readonly raw_labels: readonly string[] | null;
  readonly raw_status: string;
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface TeamContributor {
  readonly identity: {
    readonly identified: boolean;
    readonly userId: string | null;
    readonly fullName: string | null;
    readonly avatarUrl: string | null;
    readonly provider: string | null;
    readonly externalUserId: string | null;
    readonly externalUsername: string | null;
  };
  readonly workItems: { readonly total: number; readonly wip: number };
  readonly pullRequests: { readonly merged: number };
  readonly deployments: { readonly triggered: number };
  readonly incidents: { readonly assigned: number };
}

export interface TeamContributors {
  readonly contributors: readonly TeamContributor[];
}

/** Acumulador mutável interno — vira `TeamContributor` só na montagem final. */
interface ContributorAccumulator {
  identity: TeamContributor['identity'];
  workItemsTotal: number;
  workItemsWip: number;
  pullRequestsMerged: number;
  deploymentsTriggered: number;
  incidentsAssigned: number;
}

interface ProviderExternalIdCountRow {
  readonly provider: string;
  readonly external_id: string;
  readonly count: string;
}

/**
 * Perfil agregado de um time — combina roster/capacidade (`teams`,
 * `team_memberships`, hoje só CRUD, sem relatório nenhum) com métricas de
 * engenharia já sincronizadas, mas nunca agregadas por esse ângulo.
 *
 * Sem período (`from`/`to`): retrato do estado atual, mesmo espírito do
 * Flow (`DashboardService.getFlowMetrics`), não do DORA.
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 6.
 */
export class TeamProfileService {
  constructor(
    private readonly pool: Pool = getPool(),
    private readonly teamRepository: TeamRepository = new TeamRepository(),
    private readonly teamMembershipRepository: TeamMembershipRepository = new TeamMembershipRepository(),
    private readonly mappingRulesRepository: MappingRulesRepository = new MappingRulesRepository(),
  ) {}

  async getProfile(tenantId: string, teamId: string): Promise<TeamProfile | null> {
    const team = await this.teamRepository.findById(tenantId, teamId);
    if (!team) {
      return null;
    }

    const [roster, aggregates] = await Promise.all([
      this.teamMembershipRepository.findByTeamWithUser(tenantId, teamId),
      this.queryAggregates(tenantId, teamId),
    ]);

    const { wipCount, distribution, incidentsBySeverity, deploymentSuccessRate, pullRequestReviewHealth, workItemConcentration, pullRequestConcentration } =
      aggregates;

    return {
      team,
      roster,
      wip: { count: wipCount, perMember: roster.length > 0 ? wipCount / roster.length : null },
      distribution,
      incidentsBySeverity,
      deploymentSuccessRate,
      pullRequestReviewHealth,
      contributionConcentration: {
        workItems: workItemConcentration,
        pullRequests: pullRequestConcentration,
      },
    };
  }

  private async queryAggregates(
    tenantId: string,
    teamId: string,
  ): Promise<{
    readonly wipCount: number;
    readonly distribution: readonly FlowDistributionEntry[];
    readonly incidentsBySeverity: readonly { readonly severity: string; readonly count: number }[];
    readonly deploymentSuccessRate: DeploymentSuccessRateMetric | UnavailableMetric;
    readonly pullRequestReviewHealth: PullRequestReviewHealthMetric | UnavailableMetric;
    readonly workItemConcentration: ContributionConcentrationMetric | UnavailableMetric;
    readonly pullRequestConcentration: ContributionConcentrationMetric | UnavailableMetric;
  }> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const [wipCount, distribution, incidentsBySeverity, deploymentSuccessRate, pullRequestReviewHealth, workItemConcentration, pullRequestConcentration] =
        await Promise.all([
          client
            .query<{ count: string }>(
              `SELECT count(*) AS count FROM enriched_work_items WHERE team_id = $1 AND semantic_state = 'IN_PROGRESS'`,
              [teamId],
            )
            .then((result) => Number(result.rows[0].count)),
          client
            .query<{ semantic_category: string; count: string }>(
              `SELECT semantic_category, count(*) AS count
               FROM enriched_work_items
               WHERE team_id = $1
               GROUP BY semantic_category
               ORDER BY semantic_category`,
              [teamId],
            )
            .then((result) =>
              result.rows.map((row) => ({ category: row.semantic_category, count: Number(row.count) })),
            ),
          client
            .query<{ severity: string; count: string }>(
              `SELECT ci.severity, count(*) AS count
               FROM canonical_incidents ci
               JOIN enriched_incidents ei ON ei.id = ci.id
               WHERE ei.team_id = $1
               GROUP BY ci.severity
               ORDER BY ci.severity`,
              [teamId],
            )
            .then((result) => result.rows.map((row) => ({ severity: row.severity, count: Number(row.count) }))),
          client
            .query<{ status: string; count: string }>(
              `SELECT cd.status, count(*) AS count
               FROM canonical_deployments cd
               JOIN enriched_deployments ed ON ed.id = cd.id
               WHERE ed.team_id = $1
               GROUP BY cd.status`,
              [teamId],
            )
            .then((result): DeploymentSuccessRateMetric | UnavailableMetric => {
              const success = Number(result.rows.find((row) => row.status === 'SUCCESS')?.count ?? 0);
              const failure = Number(result.rows.find((row) => row.status === 'FAILURE')?.count ?? 0);
              const total = success + failure;

              return total === 0
                ? DEPLOYMENT_SUCCESS_RATE_UNAVAILABLE
                : { available: true, total, success, failure, rate: success / total };
            }),
          client
            .query<{ total_merged: string; merged_without_review: string; avg_reviewers: string | null }>(
              `SELECT
                 count(*) AS total_merged,
                 count(*) FILTER (WHERE cardinality(cpr.reviewer_external_ids) = 0) AS merged_without_review,
                 avg(cardinality(cpr.reviewer_external_ids)) AS avg_reviewers
               FROM canonical_pull_requests cpr
               JOIN team_resource_links trl
                 ON trl.provider = 'github' AND trl.resource_type = 'github_repository' AND trl.external_resource_id = cpr.repository
               WHERE cpr.state = 'MERGED' AND trl.team_id = $1`,
              [teamId],
            )
            .then((result): PullRequestReviewHealthMetric | UnavailableMetric => {
              const totalMerged = Number(result.rows[0].total_merged);

              return totalMerged === 0
                ? PR_REVIEW_HEALTH_UNAVAILABLE
                : {
                    available: true,
                    totalMerged,
                    mergedWithoutReview: Number(result.rows[0].merged_without_review),
                    avgReviewers: Number(result.rows[0].avg_reviewers),
                  };
            }),
          client
            .query<{ assignee_external_id: string; count: string }>(
              `SELECT cwi.assignee_external_id, count(*) AS count
               FROM canonical_work_items cwi
               JOIN enriched_work_items ewi ON ewi.id = cwi.id
               WHERE ewi.team_id = $1 AND cwi.assignee_external_id IS NOT NULL
               GROUP BY cwi.assignee_external_id
               ORDER BY count(*) DESC`,
              [teamId],
            )
            .then((result): ContributionConcentrationMetric | UnavailableMetric => {
              if (result.rows.length === 0) {
                return workItemConcentrationUnavailable();
              }

              const counts = result.rows.map((row) => Number(row.count));
              const sampleSize = counts.reduce((sum, count) => sum + count, 0);

              return { available: true, topContributorShare: counts[0] / sampleSize, sampleSize };
            }),
          client
            .query<{ author_external_id: string; count: string }>(
              `SELECT cpr.author_external_id, count(*) AS count
               FROM canonical_pull_requests cpr
               JOIN team_resource_links trl
                 ON trl.provider = 'github' AND trl.resource_type = 'github_repository' AND trl.external_resource_id = cpr.repository
               WHERE trl.team_id = $1 AND cpr.state = 'MERGED' AND cpr.author_external_id IS NOT NULL
               GROUP BY cpr.author_external_id
               ORDER BY count(*) DESC`,
              [teamId],
            )
            .then((result): ContributionConcentrationMetric | UnavailableMetric => {
              if (result.rows.length === 0) {
                return pullRequestConcentrationUnavailable();
              }

              const counts = result.rows.map((row) => Number(row.count));
              const sampleSize = counts.reduce((sum, count) => sum + count, 0);

              return { available: true, topContributorShare: counts[0] / sampleSize, sampleSize };
            }),
        ]);

      return {
        wipCount,
        distribution,
        incidentsBySeverity,
        deploymentSuccessRate,
        pullRequestReviewHealth,
        workItemConcentration,
        pullRequestConcentration,
      };
    });
  }

  /**
   * WIP/Distribution histórico — reconstrói o estado semântico de cada work
   * item do time em cada um dos últimos `weeks` limites semanais, a partir
   * do changelog de status (`canonical_work_item_status_transitions`).
   *
   * Reconstrução em memória, não em SQL: busca todos os work items + todas
   * as transições do time de uma vez, resolve o estado "como estava" em
   * cada data em código de aplicação — mais simples de escrever/testar
   * corretamente do que uma query com LATERAL join por item por data, e o
   * volume por time (centenas de itens, ~12-16 pontos) não justifica a
   * complexidade de fazer isso em SQL puro.
   *
   * Atribuição de time é sempre a **atual** (`enriched_work_items.team_id`
   * de hoje), aplicada retroativamente — não rastreamos histórico de
   * associação time↔projeto. `distribution` não depende das transições
   * (categoria semântica vem de `rawIssueType`/`rawLabels`, que não mudam
   * ao longo do tempo), só filtra por `createdAt <= data`; `wip` é o único
   * que precisa da reconstrução de fato.
   */
  async getProfileHistory(tenantId: string, teamId: string, weeks: number): Promise<TeamProfileHistory | null> {
    const team = await this.teamRepository.findById(tenantId, teamId);
    if (!team) {
      return null;
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      const [workItemsResult, effectiveRules] = await Promise.all([
        client.query<HistoryWorkItemRow>(
          `SELECT cwi.provider_integration_id, cwi.external_id, cwi.created_at,
                  cwi.raw_issue_type, cwi.raw_labels, cwi.raw_status
           FROM canonical_work_items cwi
           JOIN enriched_work_items ewi ON ewi.id = cwi.id
           WHERE ewi.team_id = $1`,
          [teamId],
        ),
        this.mappingRulesRepository.getEffectiveRules(tenantId, teamId),
      ]);

      const workItems = workItemsResult.rows;
      const integrationIds = [...new Set(workItems.map((item) => item.provider_integration_id))];

      const transitionsResult =
        integrationIds.length > 0
          ? await client.query<{
              provider_integration_id: string;
              work_item_external_id: string;
              from_status: string | null;
              to_status: string;
              transitioned_at: Date;
            }>(
              `SELECT provider_integration_id, work_item_external_id, from_status, to_status, transitioned_at
               FROM canonical_work_item_status_transitions
               WHERE tenant_id = $1 AND provider_integration_id = ANY($2::uuid[])
               ORDER BY transitioned_at ASC`,
              [tenantId, integrationIds],
            )
          : null;

      const transitionsByItem = new Map<string, { fromStatus: string | null; toStatus: string; transitionedAt: Date }[]>();
      for (const row of transitionsResult?.rows ?? []) {
        const key = `${row.provider_integration_id}:${row.work_item_external_id}`;
        const entry = { fromStatus: row.from_status, toStatus: row.to_status, transitionedAt: row.transitioned_at };
        const existing = transitionsByItem.get(key);
        if (existing) {
          existing.push(entry);
        } else {
          transitionsByItem.set(key, [entry]);
        }
      }

      const now = new Date();
      const pointDates: Date[] = [];
      for (let i = weeks - 1; i >= 0; i -= 1) {
        pointDates.push(new Date(now.getTime() - i * ONE_WEEK_MS));
      }

      const points = pointDates.map((date) => {
        let wip = 0;
        const categoryCounts: Record<string, number> = {};

        for (const item of workItems) {
          if (item.created_at > date) {
            continue;
          }

          const key = `${item.provider_integration_id}:${item.external_id}`;
          const itemTransitions = transitionsByItem.get(key) ?? [];
          const statusAsOf = this.resolveStatusAsOf(item.raw_status, itemTransitions, date);

          // Mesma definição de WIP de `DashboardService.queryWip`:
          // `semantic_state === 'IN_PROGRESS'`, não `isActiveTime` — os dois
          // podem divergir (`mapping_rules` permite marcar um estado
          // IN_PROGRESS com `isActiveTime: false`, e esse tenant faz
          // exatamente isso) — precisa usar a mesma definição em todo canto
          // pra "WIP" significar a mesma coisa no perfil de time e no Flow.
          const { state } = evaluateWorkflowState(statusAsOf, effectiveRules.rules);
          if (state === 'IN_PROGRESS') {
            wip += 1;
          }

          const category = evaluateWorkItemType(item.raw_issue_type, item.raw_labels ?? [], effectiveRules.rules);
          categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
        }

        const distribution: FlowDistributionEntry[] = Object.entries(categoryCounts)
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => a.category.localeCompare(b.category));

        return { date: date.toISOString().slice(0, 10), wip, distribution };
      });

      return { points };
    });
  }

  /**
   * Status de um work item "como estava" numa data — última transição
   * `<= data`; se não houver, mas o item já tinha alguma transição depois
   * dessa data, usa o `fromStatus` da primeira (era esse o status antes
   * dela); sem transição nenhuma, usa o status atual (nunca mudou).
   */
  private resolveStatusAsOf(
    currentRawStatus: string,
    transitions: readonly { fromStatus: string | null; toStatus: string; transitionedAt: Date }[],
    date: Date,
  ): string {
    let lastKnown: string | null = null;

    for (const transition of transitions) {
      if (transition.transitionedAt <= date) {
        lastKnown = transition.toStatus;
      } else {
        break;
      }
    }

    if (lastKnown !== null) {
      return lastKnown;
    }

    return transitions[0]?.fromStatus ?? currentRawStatus;
  }

  /**
   * Quebra por pessoa — agrega `assignee_external_id`/`author_external_id`/
   * `triggered_by_external_id` das 4 fontes canônicas do time (work items,
   * PRs, deploys, incidentes), resolvendo identidade em duas camadas:
   * `user_provider_aliases` (pessoa já convidada/materializada, nome real)
   * primeiro, `discovered_identities` (username/avatar do provider, sem
   * conta na plataforma) depois. Sem nenhuma das duas, só o id externo cru
   * (caso do Waroom, que nunca expõe nome). Uma pessoa identificada pode
   * agregar várias `(provider, externalId)` (Jira + GitHub da mesma pessoa,
   * já mescladas via `POST .../discovered-users/materialize`); duas pessoas
   * não identificadas nunca são fundidas entre si — cada `(provider,
   * externalId)` sem match vira uma entrada própria.
   */
  async getContributors(tenantId: string, teamId: string): Promise<TeamContributors | null> {
    const team = await this.teamRepository.findById(tenantId, teamId);
    if (!team) {
      return null;
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      const [workItemRows, prRows, deploymentRows, incidentRows, aliasRows, discoveredRows] = await Promise.all([
        client.query<{ provider: string; external_id: string; total: string; wip: string }>(
          `SELECT cwi.provider, cwi.assignee_external_id AS external_id,
                  count(*) AS total,
                  count(*) FILTER (WHERE ewi.semantic_state = 'IN_PROGRESS') AS wip
           FROM canonical_work_items cwi
           JOIN enriched_work_items ewi ON ewi.id = cwi.id
           WHERE ewi.team_id = $1 AND cwi.assignee_external_id IS NOT NULL
           GROUP BY cwi.provider, cwi.assignee_external_id`,
          [teamId],
        ),
        client.query<ProviderExternalIdCountRow>(
          `SELECT 'github' AS provider, cpr.author_external_id AS external_id, count(*) AS count
           FROM canonical_pull_requests cpr
           JOIN team_resource_links trl
             ON trl.provider = 'github' AND trl.resource_type = 'github_repository' AND trl.external_resource_id = cpr.repository
           WHERE trl.team_id = $1 AND cpr.state = 'MERGED' AND cpr.author_external_id IS NOT NULL
           GROUP BY cpr.author_external_id`,
          [teamId],
        ),
        client.query<ProviderExternalIdCountRow>(
          `SELECT cd.provider, cd.triggered_by_external_id AS external_id, count(*) AS count
           FROM canonical_deployments cd
           JOIN enriched_deployments ed ON ed.id = cd.id
           WHERE ed.team_id = $1 AND cd.triggered_by_external_id IS NOT NULL
           GROUP BY cd.provider, cd.triggered_by_external_id`,
          [teamId],
        ),
        client.query<ProviderExternalIdCountRow>(
          `SELECT ci.provider, ci.assignee_external_id AS external_id, count(*) AS count
           FROM canonical_incidents ci
           JOIN enriched_incidents ei ON ei.id = ci.id
           WHERE ei.team_id = $1 AND ci.assignee_external_id IS NOT NULL
           GROUP BY ci.provider, ci.assignee_external_id`,
          [teamId],
        ),
        client.query<{
          provider: string;
          external_user_id: string;
          user_id: string;
          full_name: string;
          avatar_url: string | null;
        }>(
          `SELECT upa.provider, upa.external_user_id, upa.user_id, u.full_name, u.avatar_url
           FROM user_provider_aliases upa
           JOIN users u ON u.id = upa.user_id
           WHERE upa.tenant_id = $1`,
          [tenantId],
        ),
        client.query<{
          provider: string;
          external_user_id: string;
          external_username: string | null;
          external_avatar_url: string | null;
        }>(
          `SELECT provider, external_user_id, external_username, external_avatar_url
           FROM discovered_identities
           WHERE tenant_id = $1`,
          [tenantId],
        ),
      ]);

      const aliasMap = new Map<string, { userId: string; fullName: string; avatarUrl: string | null }>();
      for (const row of aliasRows.rows) {
        aliasMap.set(`${row.provider}:${row.external_user_id}`, {
          userId: row.user_id,
          fullName: row.full_name,
          avatarUrl: row.avatar_url,
        });
      }

      const discoveredMap = new Map<string, { externalUsername: string | null; externalAvatarUrl: string | null }>();
      for (const row of discoveredRows.rows) {
        discoveredMap.set(`${row.provider}:${row.external_user_id}`, {
          externalUsername: row.external_username,
          externalAvatarUrl: row.external_avatar_url,
        });
      }

      const accumulators = new Map<string, ContributorAccumulator>();

      const resolveAccumulator = (provider: string, externalId: string): ContributorAccumulator => {
        const key = `${provider}:${externalId}`;
        const alias = aliasMap.get(key);
        const groupKey = alias ? `user:${alias.userId}` : `raw:${key}`;

        const existing = accumulators.get(groupKey);
        if (existing) {
          return existing;
        }

        const discovered = discoveredMap.get(key);
        const identity: TeamContributor['identity'] = alias
          ? {
              identified: true,
              userId: alias.userId,
              fullName: alias.fullName,
              avatarUrl: alias.avatarUrl,
              provider: null,
              externalUserId: null,
              externalUsername: null,
            }
          : {
              identified: false,
              userId: null,
              fullName: null,
              avatarUrl: discovered?.externalAvatarUrl ?? null,
              provider,
              externalUserId: externalId,
              externalUsername: discovered?.externalUsername ?? null,
            };

        const created: ContributorAccumulator = {
          identity,
          workItemsTotal: 0,
          workItemsWip: 0,
          pullRequestsMerged: 0,
          deploymentsTriggered: 0,
          incidentsAssigned: 0,
        };
        accumulators.set(groupKey, created);
        return created;
      };

      for (const row of workItemRows.rows) {
        const acc = resolveAccumulator(row.provider, row.external_id);
        acc.workItemsTotal += Number(row.total);
        acc.workItemsWip += Number(row.wip);
      }
      for (const row of prRows.rows) {
        resolveAccumulator(row.provider, row.external_id).pullRequestsMerged += Number(row.count);
      }
      for (const row of deploymentRows.rows) {
        resolveAccumulator(row.provider, row.external_id).deploymentsTriggered += Number(row.count);
      }
      for (const row of incidentRows.rows) {
        resolveAccumulator(row.provider, row.external_id).incidentsAssigned += Number(row.count);
      }

      const contributors = [...accumulators.values()]
        .map(
          (acc): TeamContributor => ({
            identity: acc.identity,
            workItems: { total: acc.workItemsTotal, wip: acc.workItemsWip },
            pullRequests: { merged: acc.pullRequestsMerged },
            deployments: { triggered: acc.deploymentsTriggered },
            incidents: { assigned: acc.incidentsAssigned },
          }),
        )
        .sort((a, b) => {
          const totalA = a.workItems.total + a.pullRequests.merged + a.deployments.triggered + a.incidents.assigned;
          const totalB = b.workItems.total + b.pullRequests.merged + b.deployments.triggered + b.incidents.assigned;
          return totalB - totalA;
        });

      return { contributors };
    });
  }
}
