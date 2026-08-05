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

/**
 * Horas em cards `TOIL` concluídos no mês corrente / capacidade mensal do
 * time. Escopado ao mês corrente (não `from`/`to` arbitrário) porque
 * capacidade é inerentemente mensal (`default_monthly_capacity_hours`) —
 * um período arbitrário exigiria prorratear a capacidade, mais uma fonte de
 * imprecisão sem necessidade.
 */
export interface ToilRatioMetric {
  readonly available: true;
  readonly toilHours: number;
  readonly capacityHours: number;
  readonly ratio: number;
}

/**
 * % de código "reescrito" — soma de `lines_added` de PRs mergeados cujos
 * arquivos foram tocados de novo por outro PR do mesmo repositório,
 * mergeado depois, dentro de `CODE_CHURN_WINDOW_DAYS`. Sem período: mesmo
 * espírito cumulativo/all-time de `deploymentSuccessRate`/
 * `pullRequestReviewHealth`/`contributionConcentration`, os outros 3
 * operacionais baseados em PR desta mesma tabela.
 */
export interface ReworkRateMetric {
  readonly available: true;
  readonly totalLinesAdded: number;
  readonly churnedLinesAdded: number;
  readonly rate: number;
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
  readonly toilRatio: ToilRatioMetric | UnavailableMetric;
  readonly reworkRate: ReworkRateMetric | UnavailableMetric;
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

const TOIL_RATIO_UNAVAILABLE: UnavailableMetric = {
  available: false,
  reason: 'Time sem capacidade configurada (nenhum membro no roster).',
};

const REWORK_RATE_UNAVAILABLE: UnavailableMetric = {
  available: false,
  reason: 'Nenhum PR mergeado com linhas adicionadas de repositório vinculado a este time ainda.',
};

/**
 * Janela pra considerar um PR posterior como "reescrita" de um PR anterior
 * (mesmo arquivo tocado de novo). Valor do meio do range usado por
 * ferramentas do mercado (LinearB/Swarmia, tipicamente 7-21 dias) — não
 * confirmado com o usuário, fácil de ajustar aqui se não fizer sentido.
 */
const CODE_CHURN_WINDOW_DAYS = 14;

/**
 * Trabalho concluído (`completed_at`) dentro da janela do ponto — ao
 * contrário de `distribution` (cumulativo, ver `getProfileHistory`), isso
 * pode cair de um ponto pro seguinte.
 *
 * `count` conta todo item com `completed_at` na janela, **sem** depender de
 * `started_working_at` — testando ao vivo, achamos tenants reais onde
 * nenhum item tem `started_working_at` preenchido (nunca passou por uma
 * transição de status marcada `isActiveTime` nas mapping rules), o que
 * zerava `count` inteiro se ele dependesse disso, como a convenção de
 * `DashboardService.queryCycleTime`/`toilRatio` faz. O tempo de vida é um
 * sub-conjunto à parte: só os itens com `started_working_at` entram no
 * cálculo, então `lifetimeSampleSize` pode ser menor que `count` (inclusive
 * 0 — nesse caso `avgLifetimeHours`/`medianLifetimeHours` vêm `null`).
 */
export interface TeamProfileHistoryCompletedEntry {
  readonly category: string;
  readonly count: number;
  readonly lifetimeSampleSize: number;
  readonly avgLifetimeHours: number | null;
  readonly medianLifetimeHours: number | null;
}

export interface TeamProfileHistoryPoint {
  readonly date: string;
  readonly wip: number;
  readonly distribution: readonly FlowDistributionEntry[];
  readonly completed: readonly TeamProfileHistoryCompletedEntry[];
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
  readonly completed_at: Date | null;
  readonly started_working_at: Date | null;
  readonly semantic_category: string;
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Mediana de um array já ordenado ascendentemente — sem dependência nova, volume por categoria/semana é baixo. */
function medianOfSorted(sortedAscValues: readonly number[]): number {
  const mid = Math.floor(sortedAscValues.length / 2);
  return sortedAscValues.length % 2 !== 0
    ? sortedAscValues[mid]
    : (sortedAscValues[mid - 1] + sortedAscValues[mid]) / 2;
}

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
  readonly workItems: {
    readonly total: number;
    readonly wip: number;
    /** `semantic_category` → contagem (ex: `{ "BUG": 5, "FEATURE": 12 }`) — categorias sem item desta pessoa não aparecem. */
    readonly byCategory: Readonly<Record<string, number>>;
  };
  readonly pullRequests: { readonly merged: number; readonly reviewed: number };
  readonly deployments: {
    readonly triggered: number;
    readonly success: number;
    readonly failure: number;
    /** `success / (success + failure)` — `null` se a soma for 0 (mesmo espírito de `available: false` do `deploymentSuccessRate` do time, só que sem o wrapper, pra não inflar o payload por pessoa). */
    readonly rate: number | null;
  };
  readonly incidents: { readonly assigned: number };
  /** Mesma janela/fórmula do `toilRatio` do time (`GET .../profile`) — mês corrente, `completed_at - started_working_at`. */
  readonly toil: {
    readonly hoursThisMonth: number;
    /** Fração (0-1) do total de horas de toil do time neste mês que veio desta pessoa. `0` se o time não teve toil nenhum no mês. */
    readonly shareOfTeamToil: number;
  };
}

export interface TeamContributors {
  readonly contributors: readonly TeamContributor[];
}

export interface TeamContributorActivity {
  readonly identity: TeamContributor['identity'];
  readonly workItemsCompleted: number;
  readonly pullRequestsMerged: number;
  readonly deploymentsTriggered: number;
  readonly incidentsAssigned: number;
}

export interface TeamContributorHistoryPoint {
  readonly date: string;
  /** Só quem teve pelo menos 1 atividade nesta janela — mesma convenção de `distribution`/`completed` em `TeamProfileHistory`, sem entrada zerada. */
  readonly contributors: readonly TeamContributorActivity[];
}

export interface TeamContributorsHistory {
  readonly points: readonly TeamContributorHistoryPoint[];
}

/** Acumulador mutável interno — vira `TeamContributor` só na montagem final. */
interface ContributorAccumulator {
  identity: TeamContributor['identity'];
  workItemsTotal: number;
  workItemsWip: number;
  workItemsByCategory: Record<string, number>;
  pullRequestsMerged: number;
  pullRequestsReviewed: number;
  deploymentsTriggered: number;
  deploymentsSuccess: number;
  deploymentsFailure: number;
  incidentsAssigned: number;
  toilHours: number;
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

    const {
      wipCount,
      distribution,
      incidentsBySeverity,
      deploymentSuccessRate,
      pullRequestReviewHealth,
      workItemConcentration,
      pullRequestConcentration,
      toilHours,
      reworkRate,
    } = aggregates;

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
      toilRatio: this.computeToilRatio(team, roster, toilHours),
      reworkRate,
    };
  }

  /**
   * Capacidade somada em TypeScript, não SQL — mesmo racional já
   * documentado em `getProfileHistory`: volume de roster (dezenas de
   * pessoas) não justifica mover isso pro banco. Cada membro usa a própria
   * capacidade customizada quando definida, senão a default do time,
   * escalada pelo % de alocação.
   */
  private computeToilRatio(
    team: Team,
    roster: readonly TeamMembershipWithUser[],
    toilHours: number,
  ): ToilRatioMetric | UnavailableMetric {
    if (roster.length === 0) {
      return TOIL_RATIO_UNAVAILABLE;
    }

    const capacityHours = roster.reduce((sum, { membership }) => {
      const baseHours = membership.customMonthlyCapacityHours ?? team.defaultMonthlyCapacityHours;
      return sum + baseHours * (membership.capacityAllocationPercent / 100);
    }, 0);

    if (capacityHours === 0) {
      return TOIL_RATIO_UNAVAILABLE;
    }

    return { available: true, toilHours, capacityHours, ratio: toilHours / capacityHours };
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
    readonly toilHours: number;
    readonly reworkRate: ReworkRateMetric | UnavailableMetric;
  }> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const [
        wipCount,
        distribution,
        incidentsBySeverity,
        deploymentSuccessRate,
        pullRequestReviewHealth,
        workItemConcentration,
        pullRequestConcentration,
        toilHours,
        reworkRate,
      ] = await Promise.all([
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
          client
            .query<{ toil_hours: string | null }>(
              `SELECT SUM(EXTRACT(EPOCH FROM (completed_at - started_working_at)) / 3600) AS toil_hours
               FROM enriched_work_items
               WHERE team_id = $1
                 AND semantic_category = 'TOIL'
                 AND started_working_at IS NOT NULL
                 AND completed_at >= date_trunc('month', NOW())`,
              [teamId],
            )
            .then((result) => (result.rows[0].toil_hours !== null ? Number(result.rows[0].toil_hours) : 0)),
          client
            .query<{ total_lines: string | null; churned_lines: string | null }>(
              `WITH merged_prs AS (
                 SELECT cpr.repository, cpr.changed_files, cpr.lines_added, cpr.merged_at
                 FROM canonical_pull_requests cpr
                 JOIN team_resource_links trl
                   ON trl.provider = 'github' AND trl.resource_type = 'github_repository' AND trl.external_resource_id = cpr.repository
                 WHERE trl.team_id = $1 AND cpr.state = 'MERGED' AND cpr.merged_at IS NOT NULL
               )
               SELECT
                 SUM(mp.lines_added) AS total_lines,
                 SUM(mp.lines_added) FILTER (WHERE EXISTS (
                   SELECT 1 FROM canonical_pull_requests later
                   WHERE later.repository = mp.repository
                     AND later.state = 'MERGED'
                     AND later.merged_at > mp.merged_at
                     AND later.merged_at <= mp.merged_at + (${CODE_CHURN_WINDOW_DAYS} || ' days')::interval
                     AND later.changed_files && mp.changed_files
                 )) AS churned_lines
               FROM merged_prs mp`,
              [teamId],
            )
            .then((result): ReworkRateMetric | UnavailableMetric => {
              const totalLinesAdded = Number(result.rows[0].total_lines ?? 0);

              if (totalLinesAdded === 0) {
                return REWORK_RATE_UNAVAILABLE;
              }

              const churnedLinesAdded = Number(result.rows[0].churned_lines ?? 0);

              return { available: true, totalLinesAdded, churnedLinesAdded, rate: churnedLinesAdded / totalLinesAdded };
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
        toilHours,
        reworkRate,
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
   *
   * `completed`, ao contrário de `distribution`, **não é cumulativo** —
   * escopado à janela `(ponto anterior, este ponto]` por `completed_at`,
   * então pode cair de uma semana pra outra (ex: menos toil concluído essa
   * semana vs a passada). `count` não depende de `started_working_at`
   * (achamos tenants reais onde isso vem sempre `null`); o tempo de vida
   * (mesma fórmula de `DashboardService.queryCycleTime`) é um sub-conjunto
   * à parte, `lifetimeSampleSize` <= `count`.
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
                  cwi.raw_issue_type, cwi.raw_labels, cwi.raw_status,
                  ewi.completed_at, ewi.started_working_at, ewi.semantic_category
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

      const points = pointDates.map((date, index) => {
        const windowStart = index === 0 ? new Date(date.getTime() - ONE_WEEK_MS) : pointDates[index - 1];

        let wip = 0;
        const categoryCounts: Record<string, number> = {};
        const completedCountByCategory = new Map<string, number>();
        const completedLifetimeHoursByCategory = new Map<string, number[]>();

        for (const item of workItems) {
          if (item.completed_at !== null && item.completed_at > windowStart && item.completed_at <= date) {
            completedCountByCategory.set(
              item.semantic_category,
              (completedCountByCategory.get(item.semantic_category) ?? 0) + 1,
            );

            if (item.started_working_at !== null) {
              const lifetimeHours = (item.completed_at.getTime() - item.started_working_at.getTime()) / (60 * 60 * 1000);
              const existing = completedLifetimeHoursByCategory.get(item.semantic_category);
              if (existing) {
                existing.push(lifetimeHours);
              } else {
                completedLifetimeHoursByCategory.set(item.semantic_category, [lifetimeHours]);
              }
            }
          }

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

        const completed: TeamProfileHistoryCompletedEntry[] = [...completedCountByCategory.entries()]
          .map(([category, count]) => {
            const hours = completedLifetimeHoursByCategory.get(category);
            const sorted = hours ? [...hours].sort((a, b) => a - b) : [];
            return {
              category,
              count,
              lifetimeSampleSize: sorted.length,
              avgLifetimeHours: sorted.length > 0 ? sorted.reduce((sum, h) => sum + h, 0) / sorted.length : null,
              medianLifetimeHours: sorted.length > 0 ? medianOfSorted(sorted) : null,
            };
          })
          .sort((a, b) => a.category.localeCompare(b.category));

        return { date: date.toISOString().slice(0, 10), wip, distribution, completed };
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
   * Monta os dois mapas de resolução de identidade (`provider:externalId` →
   * pessoa/username) a partir das linhas já buscadas — puro, sem acesso a
   * banco, pra ser reaproveitado por `getContributors` e
   * `getContributorsHistory` sem duplicar a query nem a lógica de merge.
   */
  private buildIdentityLookups(
    aliasRows: readonly { provider: string; external_user_id: string; user_id: string; full_name: string; avatar_url: string | null }[],
    discoveredRows: readonly {
      provider: string;
      external_user_id: string;
      external_username: string | null;
      external_avatar_url: string | null;
    }[],
  ): {
    aliasMap: Map<string, { userId: string; fullName: string; avatarUrl: string | null }>;
    discoveredMap: Map<string, { externalUsername: string | null; externalAvatarUrl: string | null }>;
  } {
    const aliasMap = new Map<string, { userId: string; fullName: string; avatarUrl: string | null }>();
    for (const row of aliasRows) {
      aliasMap.set(`${row.provider}:${row.external_user_id}`, {
        userId: row.user_id,
        fullName: row.full_name,
        avatarUrl: row.avatar_url,
      });
    }

    const discoveredMap = new Map<string, { externalUsername: string | null; externalAvatarUrl: string | null }>();
    for (const row of discoveredRows) {
      discoveredMap.set(`${row.provider}:${row.external_user_id}`, {
        externalUsername: row.external_username,
        externalAvatarUrl: row.external_avatar_url,
      });
    }

    return { aliasMap, discoveredMap };
  }

  /**
   * `groupKey` funde `(provider, externalId)` numa mesma pessoa quando há
   * alias (`user:userId`); sem alias, cada `(provider, externalId)` fica
   * isolado (`raw:provider:externalId`) — mesma regra pra qualquer chamador,
   * ver doc de `getContributors` pra motivação completa.
   */
  private resolveContributorIdentity(
    provider: string,
    externalId: string,
    aliasMap: Map<string, { userId: string; fullName: string; avatarUrl: string | null }>,
    discoveredMap: Map<string, { externalUsername: string | null; externalAvatarUrl: string | null }>,
  ): { groupKey: string; identity: TeamContributor['identity'] } {
    const key = `${provider}:${externalId}`;
    const alias = aliasMap.get(key);
    const groupKey = alias ? `user:${alias.userId}` : `raw:${key}`;

    if (alias) {
      return {
        groupKey,
        identity: {
          identified: true,
          userId: alias.userId,
          fullName: alias.fullName,
          avatarUrl: alias.avatarUrl,
          provider: null,
          externalUserId: null,
          externalUsername: null,
        },
      };
    }

    const discovered = discoveredMap.get(key);
    return {
      groupKey,
      identity: {
        identified: false,
        userId: null,
        fullName: null,
        avatarUrl: discovered?.externalAvatarUrl ?? null,
        provider,
        externalUserId: externalId,
        externalUsername: discovered?.externalUsername ?? null,
      },
    };
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
      const [
        workItemRows,
        prRows,
        prReviewRows,
        deploymentRows,
        incidentRows,
        toilRows,
        aliasRows,
        discoveredRows,
      ] = await Promise.all([
        client.query<{ provider: string; external_id: string; category: string; total: string; wip: string }>(
          `SELECT cwi.provider, cwi.assignee_external_id AS external_id, ewi.semantic_category AS category,
                  count(*) AS total,
                  count(*) FILTER (WHERE ewi.semantic_state = 'IN_PROGRESS') AS wip
           FROM canonical_work_items cwi
           JOIN enriched_work_items ewi ON ewi.id = cwi.id
           WHERE ewi.team_id = $1 AND cwi.assignee_external_id IS NOT NULL
           GROUP BY cwi.provider, cwi.assignee_external_id, ewi.semantic_category`,
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
        // Revisor — diferente de author_external_id (quem abriu/mergeou):
        // reviewer_external_ids é array, um PR pode ter vários revisores,
        // por isso o unnest em vez de um count(*) direto.
        client.query<ProviderExternalIdCountRow>(
          `SELECT 'github' AS provider, reviewer_id AS external_id, count(*) AS count
           FROM canonical_pull_requests cpr
           JOIN team_resource_links trl
             ON trl.provider = 'github' AND trl.resource_type = 'github_repository' AND trl.external_resource_id = cpr.repository
           CROSS JOIN LATERAL unnest(cpr.reviewer_external_ids) AS reviewer_id
           WHERE trl.team_id = $1 AND cpr.state = 'MERGED'
           GROUP BY reviewer_id`,
          [teamId],
        ),
        client.query<{ provider: string; external_id: string; total: string; success: string; failure: string }>(
          `SELECT cd.provider, cd.triggered_by_external_id AS external_id,
                  count(*) AS total,
                  count(*) FILTER (WHERE cd.status = 'SUCCESS') AS success,
                  count(*) FILTER (WHERE cd.status = 'FAILURE') AS failure
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
        // Mesma janela/filtro do toilRatio do time (ver computeToilRatio) —
        // só quebrado por assignee em vez de somado no time inteiro.
        client.query<{ provider: string; external_id: string; toil_hours: string | null }>(
          `SELECT cwi.provider, cwi.assignee_external_id AS external_id,
                  SUM(EXTRACT(EPOCH FROM (ewi.completed_at - ewi.started_working_at)) / 3600) AS toil_hours
           FROM canonical_work_items cwi
           JOIN enriched_work_items ewi ON ewi.id = cwi.id
           WHERE ewi.team_id = $1
             AND ewi.semantic_category = 'TOIL'
             AND ewi.started_working_at IS NOT NULL
             AND ewi.completed_at >= date_trunc('month', NOW())
             AND cwi.assignee_external_id IS NOT NULL
           GROUP BY cwi.provider, cwi.assignee_external_id`,
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

      const { aliasMap, discoveredMap } = this.buildIdentityLookups(aliasRows.rows, discoveredRows.rows);

      const accumulators = new Map<string, ContributorAccumulator>();

      const resolveAccumulator = (provider: string, externalId: string): ContributorAccumulator => {
        const { groupKey, identity } = this.resolveContributorIdentity(provider, externalId, aliasMap, discoveredMap);

        const existing = accumulators.get(groupKey);
        if (existing) {
          return existing;
        }

        const created: ContributorAccumulator = {
          identity,
          workItemsTotal: 0,
          workItemsWip: 0,
          workItemsByCategory: {},
          pullRequestsMerged: 0,
          pullRequestsReviewed: 0,
          deploymentsTriggered: 0,
          deploymentsSuccess: 0,
          deploymentsFailure: 0,
          incidentsAssigned: 0,
          toilHours: 0,
        };
        accumulators.set(groupKey, created);
        return created;
      };

      for (const row of workItemRows.rows) {
        const acc = resolveAccumulator(row.provider, row.external_id);
        acc.workItemsTotal += Number(row.total);
        acc.workItemsWip += Number(row.wip);
        acc.workItemsByCategory[row.category] = (acc.workItemsByCategory[row.category] ?? 0) + Number(row.total);
      }
      for (const row of prRows.rows) {
        resolveAccumulator(row.provider, row.external_id).pullRequestsMerged += Number(row.count);
      }
      for (const row of prReviewRows.rows) {
        resolveAccumulator(row.provider, row.external_id).pullRequestsReviewed += Number(row.count);
      }
      for (const row of deploymentRows.rows) {
        const acc = resolveAccumulator(row.provider, row.external_id);
        acc.deploymentsTriggered += Number(row.total);
        acc.deploymentsSuccess += Number(row.success);
        acc.deploymentsFailure += Number(row.failure);
      }
      for (const row of incidentRows.rows) {
        resolveAccumulator(row.provider, row.external_id).incidentsAssigned += Number(row.count);
      }
      for (const row of toilRows.rows) {
        resolveAccumulator(row.provider, row.external_id).toilHours += row.toil_hours !== null ? Number(row.toil_hours) : 0;
      }

      const teamToilHours = [...accumulators.values()].reduce((sum, acc) => sum + acc.toilHours, 0);

      const contributors = [...accumulators.values()]
        .map(
          (acc): TeamContributor => ({
            identity: acc.identity,
            workItems: { total: acc.workItemsTotal, wip: acc.workItemsWip, byCategory: acc.workItemsByCategory },
            pullRequests: { merged: acc.pullRequestsMerged, reviewed: acc.pullRequestsReviewed },
            deployments: {
              triggered: acc.deploymentsTriggered,
              success: acc.deploymentsSuccess,
              failure: acc.deploymentsFailure,
              rate:
                acc.deploymentsSuccess + acc.deploymentsFailure > 0
                  ? acc.deploymentsSuccess / (acc.deploymentsSuccess + acc.deploymentsFailure)
                  : null,
            },
            incidents: { assigned: acc.incidentsAssigned },
            toil: {
              hoursThisMonth: acc.toilHours,
              shareOfTeamToil: teamToilHours > 0 ? acc.toilHours / teamToilHours : 0,
            },
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

  /**
   * Tendência semanal de `getContributors` — quem fez o quê, semana a
   * semana, **não cumulativo** (mesmo espírito de `completed` em
   * `getProfileHistory`, não de `distribution`): cada ponto é escopado só à
   * janela `(ponto anterior, este ponto]`, uma pessoa pode sumir e voltar a
   * aparecer entre pontos. Pensado pra detectar ramp-up, rotação, ausência —
   * não pra ranquear performance (evite usar isso como métrica de
   * produtividade individual isolada).
   *
   * Sem `wip`/toil/revisão/status de deploy aqui de propósito: reconstruir
   * WIP histórico por pessoa exigiria repetir o replay de changelog de
   * `getProfileHistory` multiplicado por pessoa (caro, e o ganho de insight
   * é marginal frente ao WIP agregado do time que já existe). Se isso virar
   * necessidade real, é extensão natural do mesmo método.
   */
  async getContributorsHistory(tenantId: string, teamId: string, weeks: number): Promise<TeamContributorsHistory | null> {
    const team = await this.teamRepository.findById(tenantId, teamId);
    if (!team) {
      return null;
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      const [workItemRows, prRows, deploymentRows, incidentRows, aliasRows, discoveredRows] = await Promise.all([
        client.query<{ provider: string; external_id: string; completed_at: Date }>(
          `SELECT cwi.provider, cwi.assignee_external_id AS external_id, ewi.completed_at
           FROM canonical_work_items cwi
           JOIN enriched_work_items ewi ON ewi.id = cwi.id
           WHERE ewi.team_id = $1 AND cwi.assignee_external_id IS NOT NULL AND ewi.completed_at IS NOT NULL`,
          [teamId],
        ),
        client.query<{ provider: string; external_id: string; merged_at: Date }>(
          `SELECT 'github' AS provider, cpr.author_external_id AS external_id, cpr.merged_at
           FROM canonical_pull_requests cpr
           JOIN team_resource_links trl
             ON trl.provider = 'github' AND trl.resource_type = 'github_repository' AND trl.external_resource_id = cpr.repository
           WHERE trl.team_id = $1 AND cpr.state = 'MERGED' AND cpr.author_external_id IS NOT NULL AND cpr.merged_at IS NOT NULL`,
          [teamId],
        ),
        client.query<{ provider: string; external_id: string; started_at: Date }>(
          `SELECT cd.provider, cd.triggered_by_external_id AS external_id, cd.started_at
           FROM canonical_deployments cd
           JOIN enriched_deployments ed ON ed.id = cd.id
           WHERE ed.team_id = $1 AND cd.triggered_by_external_id IS NOT NULL`,
          [teamId],
        ),
        client.query<{ provider: string; external_id: string; triggered_at: Date }>(
          `SELECT ci.provider, ci.assignee_external_id AS external_id, ci.triggered_at
           FROM canonical_incidents ci
           JOIN enriched_incidents ei ON ei.id = ci.id
           WHERE ei.team_id = $1 AND ci.assignee_external_id IS NOT NULL`,
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

      const { aliasMap, discoveredMap } = this.buildIdentityLookups(aliasRows.rows, discoveredRows.rows);

      const now = new Date();
      const pointDates: Date[] = [];
      for (let i = weeks - 1; i >= 0; i -= 1) {
        pointDates.push(new Date(now.getTime() - i * ONE_WEEK_MS));
      }

      const points: TeamContributorHistoryPoint[] = pointDates.map((date, index) => {
        const windowStart = index === 0 ? new Date(date.getTime() - ONE_WEEK_MS) : pointDates[index - 1];

        interface Accumulator {
          identity: TeamContributor['identity'];
          workItemsCompleted: number;
          pullRequestsMerged: number;
          deploymentsTriggered: number;
          incidentsAssigned: number;
        }
        const byPerson = new Map<string, Accumulator>();

        const bump = (provider: string, externalId: string, field: keyof Omit<Accumulator, 'identity'>) => {
          const { groupKey, identity } = this.resolveContributorIdentity(provider, externalId, aliasMap, discoveredMap);
          const existing = byPerson.get(groupKey);
          if (existing) {
            existing[field] += 1;
          } else {
            byPerson.set(groupKey, {
              identity,
              workItemsCompleted: 0,
              pullRequestsMerged: 0,
              deploymentsTriggered: 0,
              incidentsAssigned: 0,
              [field]: 1,
            } as Accumulator);
          }
        };

        for (const row of workItemRows.rows) {
          if (row.completed_at > windowStart && row.completed_at <= date) {
            bump(row.provider, row.external_id, 'workItemsCompleted');
          }
        }
        for (const row of prRows.rows) {
          if (row.merged_at > windowStart && row.merged_at <= date) {
            bump(row.provider, row.external_id, 'pullRequestsMerged');
          }
        }
        for (const row of deploymentRows.rows) {
          if (row.started_at > windowStart && row.started_at <= date) {
            bump(row.provider, row.external_id, 'deploymentsTriggered');
          }
        }
        for (const row of incidentRows.rows) {
          if (row.triggered_at > windowStart && row.triggered_at <= date) {
            bump(row.provider, row.external_id, 'incidentsAssigned');
          }
        }

        const contributors = [...byPerson.values()].sort((a, b) => {
          const totalA = a.workItemsCompleted + a.pullRequestsMerged + a.deploymentsTriggered + a.incidentsAssigned;
          const totalB = b.workItemsCompleted + b.pullRequestsMerged + b.deploymentsTriggered + b.incidentsAssigned;
          return totalB - totalA;
        });

        return { date: date.toISOString().slice(0, 10), contributors };
      });

      return { points };
    });
  }
}
