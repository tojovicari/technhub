import { getPool, withTenantContext } from '../database/pool';
import type { Pool, PoolClient } from 'pg';
import { UserRepository } from '../identity/user.repository';
import { UserProviderAliasRepository } from '../identity/user-provider-alias.repository';
import { TeamRepository } from '../identity/team.repository';
import { TeamMembershipRepository } from '../identity/team-membership.repository';
import type { User } from '../identity/identity.types';
import { computeLifetimeStats } from './lifetime-stats.util';
import { buildEpicBreakdown } from './epic-breakdown.util';
import type { EpicBreakdownMetric } from './team-profile.service';
import type { UnavailableMetric } from './dashboard.service';

export interface PersonProfileAlias {
  readonly id: string;
  readonly provider: string;
  readonly externalUserId: string;
  readonly externalUsername: string | null;
}

interface PersonWorkBreakdown {
  readonly workItems: {
    readonly total: number;
    readonly wip: number;
    readonly byCategory: Readonly<Record<string, number>>;
  };
  readonly pullRequests: { readonly merged: number; readonly reviewed: number };
  readonly deployments: {
    readonly triggered: number;
    readonly success: number;
    readonly failure: number;
    readonly rate: number | null;
  };
  readonly incidents: { readonly assigned: number };
}

export interface PersonProfileTeamBreakdown extends PersonWorkBreakdown {
  /** `null` = contribuição real, mas em recurso ainda não vinculado a nenhum time (não é erro). */
  readonly team: { readonly id: string; readonly name: string } | null;
}

export interface PersonProfilePeriod {
  readonly from: string;
  readonly to: string;
}

export interface PersonToilMetric {
  readonly available: true;
  readonly hoursThisMonth: number;
  /** Soma da capacidade da própria pessoa em todas as memberships (`customMonthlyCapacityHours ?? team.defaultMonthlyCapacityHours`, escalado por `capacityAllocationPercent`) — não é capacidade de time, é a fatia dela. */
  readonly capacityHours: number;
  readonly ratio: number;
}

export interface PersonToilUnavailable {
  readonly available: false;
  readonly reason: string;
}

export interface PersonProfile {
  readonly user: Pick<User, 'id' | 'fullName' | 'primaryEmail' | 'avatarUrl' | 'systemRole' | 'status'>;
  readonly aliases: readonly PersonProfileAlias[];
  /** Eco do período aplicado — `null` = all-time (comportamento original). `wip`/`toil` nunca respeitam período, mesmo preenchido (ver docs). */
  readonly period: PersonProfilePeriod | null;
  readonly summary: PersonWorkBreakdown;
  /** Sempre mês corrente, independente de `period` — mesma razão do `toilRatio` do time (capacidade não prorrateia). Só no nível de `summary`, não quebrado por `byTeam`. */
  readonly toil: PersonToilMetric | PersonToilUnavailable;
  readonly byTeam: readonly PersonProfileTeamBreakdown[];
}

/**
 * Trabalho concluído/incidentes por semana, não cumulativo — mesmo espírito
 * de `TeamProfileHistoryPoint`/`DoraHistoryPoint`: janela `(ponto anterior,
 * este ponto]`. `completedWorkItems` ganhou tempo de vida por categoria
 * (mesma fórmula de `TeamProfileHistoryCompletedEntry`); `pullRequestsMerged`/
 * `deploymentsTriggered` são números crus (sem categoria, mesma convenção
 * de `TeamContributorActivity`).
 */
export interface PersonProfileHistoryCompletedEntry {
  readonly category: string;
  readonly count: number;
  readonly lifetimeSampleSize: number;
  readonly avgLifetimeHours: number | null;
  readonly medianLifetimeHours: number | null;
}

export interface PersonProfileHistoryPoint {
  readonly date: string;
  readonly completedWorkItems: readonly PersonProfileHistoryCompletedEntry[];
  readonly pullRequestsMerged: number;
  readonly deploymentsTriggered: number;
  readonly incidentsAssigned: number;
}

export interface PersonProfileHistory {
  readonly points: readonly PersonProfileHistoryPoint[];
}

/** Acumulador mutável interno, chaveado por `team_id` (ou `'unlinked'`) — vira `PersonProfileTeamBreakdown` na montagem final. */
interface TeamAccumulator {
  teamId: string | null;
  workItemsTotal: number;
  workItemsWip: number;
  workItemsByCategory: Record<string, number>;
  pullRequestsMerged: number;
  pullRequestsReviewed: number;
  deploymentsTriggered: number;
  deploymentsSuccess: number;
  deploymentsFailure: number;
  incidentsAssigned: number;
}

const UNLINKED_KEY = 'unlinked';
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function emptyBreakdown(): PersonWorkBreakdown {
  return {
    workItems: { total: 0, wip: 0, byCategory: {} },
    pullRequests: { merged: 0, reviewed: 0 },
    deployments: { triggered: 0, success: 0, failure: 0, rate: null },
    incidents: { assigned: 0 },
  };
}

const TOIL_UNAVAILABLE: PersonToilUnavailable = {
  available: false,
  reason: 'Pessoa sem nenhuma membership de time — sem capacidade própria pra calcular a fração de toil.',
};

/**
 * Perfil agregado de uma pessoa — inverso do `TeamProfileService.getContributors`:
 * em vez de "time → pessoas", é "pessoa → tudo que ela tocou, em todos os
 * times". Reaproveita a mesma resolução de identidade (`user_provider_aliases`)
 * e os mesmos padrões de JOIN pra time por fonte canônica, só sem o filtro
 * `team_id = $1` — agrupa por time em vez de filtrar por um só.
 *
 * `from`/`to` opcional (mesma regra de `TeamProfileService.getContributors`,
 * via `parseOptionalPeriod` compartilhado): sem período, all-time original.
 * `wip`/`toil` nunca respeitam período — `wip` é sempre "agora", `toil` é
 * sempre mês corrente (capacidade não prorrateia, mesma razão do time).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 6.
 */
export class PersonProfileService {
  constructor(
    private readonly pool: Pool = getPool(),
    private readonly userRepository: UserRepository = new UserRepository(),
    private readonly userProviderAliasRepository: UserProviderAliasRepository = new UserProviderAliasRepository(),
    private readonly teamRepository: TeamRepository = new TeamRepository(),
    private readonly teamMembershipRepository: TeamMembershipRepository = new TeamMembershipRepository(),
  ) {}

  async getProfile(
    tenantId: string,
    userId: string,
    period?: { readonly from: Date; readonly to: Date } | null,
  ): Promise<PersonProfile | null> {
    const user = await this.userRepository.findById(tenantId, userId);
    if (!user) {
      return null;
    }

    const aliases = await this.userProviderAliasRepository.findByUserId(tenantId, userId);

    const baseProfile: Pick<PersonProfile, 'user' | 'aliases'> = {
      user: {
        id: user.id,
        fullName: user.fullName,
        primaryEmail: user.primaryEmail,
        avatarUrl: user.avatarUrl,
        systemRole: user.systemRole,
        status: user.status,
      },
      aliases: aliases.map((alias) => ({
        id: alias.id,
        provider: alias.provider,
        externalUserId: alias.externalUserId,
        externalUsername: alias.externalUsername,
      })),
    };

    const periodEcho: PersonProfilePeriod | null = period
      ? { from: period.from.toISOString(), to: period.to.toISOString() }
      : null;

    // Sem alias nenhum, não tem como achar nada nas fontes canônicas — evita
    // rodar as queries à toa. Não é erro: usuário existe, só não foi
    // vinculado a nenhuma identidade externa ainda.
    if (aliases.length === 0) {
      return { ...baseProfile, period: periodEcho, summary: emptyBreakdown(), toil: TOIL_UNAVAILABLE, byTeam: [] };
    }

    const providers = aliases.map((alias) => alias.provider);
    const externalIds = aliases.map((alias) => alias.externalUserId);

    const [{ byTeamMap, toilHours }, memberships, teams] = await Promise.all([
      withTenantContext(this.pool, tenantId, async (client) => {
        const [byTeamMap, toilHours] = await Promise.all([
          this.queryBreakdownByTeam(client, providers, externalIds, period ?? null),
          this.queryToilHours(client, providers, externalIds),
        ]);
        return { byTeamMap, toilHours };
      }),
      this.teamMembershipRepository.findByUserId(tenantId, userId),
      this.teamRepository.findAllByTenant(tenantId),
    ]);

    const teamNameById = new Map(teams.map((team) => [team.id, team.name]));
    const rawAccs = [...byTeamMap.values()];

    const byTeamRaw: PersonProfileTeamBreakdown[] = rawAccs
      .map((acc) => ({
        team: acc.teamId ? { id: acc.teamId, name: teamNameById.get(acc.teamId) ?? acc.teamId } : null,
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
      }))
      .sort((a, b) => (a.team?.name ?? '').localeCompare(b.team?.name ?? ''));

    // Mesma regra de "fantasma" de `TeamProfileService.getContributors`:
    // com período ativo, uma linha de byTeam só com resíduo de wip (ex:
    // ticket velho ainda IN_PROGRESS num time que a pessoa não toca mais)
    // não aparece — soma sempre a partir de byTeamRaw (não filtrado), então
    // wip residual continua contando pro summary mesmo que a linha de
    // byTeam correspondente seja escondida.
    const periodActive = period !== null && period !== undefined;
    const byTeam = periodActive
      ? byTeamRaw.filter(
          (entry) =>
            entry.workItems.total > 0 ||
            entry.pullRequests.merged > 0 ||
            entry.deployments.triggered > 0 ||
            entry.incidents.assigned > 0,
        )
      : byTeamRaw;

    const summaryByCategory: Record<string, number> = {};
    for (const acc of rawAccs) {
      for (const [category, count] of Object.entries(acc.workItemsByCategory)) {
        summaryByCategory[category] = (summaryByCategory[category] ?? 0) + count;
      }
    }

    const totals = rawAccs.reduce(
      (sum, acc) => ({
        workItemsTotal: sum.workItemsTotal + acc.workItemsTotal,
        workItemsWip: sum.workItemsWip + acc.workItemsWip,
        pullRequestsMerged: sum.pullRequestsMerged + acc.pullRequestsMerged,
        pullRequestsReviewed: sum.pullRequestsReviewed + acc.pullRequestsReviewed,
        deploymentsTriggered: sum.deploymentsTriggered + acc.deploymentsTriggered,
        deploymentsSuccess: sum.deploymentsSuccess + acc.deploymentsSuccess,
        deploymentsFailure: sum.deploymentsFailure + acc.deploymentsFailure,
        incidentsAssigned: sum.incidentsAssigned + acc.incidentsAssigned,
      }),
      {
        workItemsTotal: 0,
        workItemsWip: 0,
        pullRequestsMerged: 0,
        pullRequestsReviewed: 0,
        deploymentsTriggered: 0,
        deploymentsSuccess: 0,
        deploymentsFailure: 0,
        incidentsAssigned: 0,
      },
    );

    const summary: PersonWorkBreakdown = {
      workItems: { total: totals.workItemsTotal, wip: totals.workItemsWip, byCategory: summaryByCategory },
      pullRequests: { merged: totals.pullRequestsMerged, reviewed: totals.pullRequestsReviewed },
      deployments: {
        triggered: totals.deploymentsTriggered,
        success: totals.deploymentsSuccess,
        failure: totals.deploymentsFailure,
        rate:
          totals.deploymentsSuccess + totals.deploymentsFailure > 0
            ? totals.deploymentsSuccess / (totals.deploymentsSuccess + totals.deploymentsFailure)
            : null,
      },
      incidents: { assigned: totals.incidentsAssigned },
    };

    const capacityHours = memberships.reduce((sum, membership) => {
      const baseHours = membership.customMonthlyCapacityHours ?? membership.teamDefaultMonthlyCapacityHours;
      return sum + baseHours * (membership.capacityAllocationPercent / 100);
    }, 0);

    const toil: PersonToilMetric | PersonToilUnavailable =
      memberships.length === 0
        ? TOIL_UNAVAILABLE
        : { available: true, hoursThisMonth: toilHours, capacityHours, ratio: capacityHours > 0 ? toilHours / capacityHours : 0 };

    return { ...baseProfile, period: periodEcho, summary, toil, byTeam };
  }

  /**
   * Quebra de `semantic_category` por épico — inverso de
   * `TeamProfileService.getEpicBreakdown` (por pessoa, cruzando todos os
   * times/projetos que ela toca, em vez de um `team_id` só). Mesma
   * agregação (`buildEpicBreakdown`), só a query muda: casa por alias da
   * pessoa (`assignee_external_id`) em vez de filtrar por `team_id`.
   */
  async getEpicBreakdown(tenantId: string, userId: string): Promise<EpicBreakdownMetric | UnavailableMetric | null> {
    const user = await this.userRepository.findById(tenantId, userId);
    if (!user) {
      return null;
    }

    const aliases = await this.userProviderAliasRepository.findByUserId(tenantId, userId);
    if (aliases.length === 0) {
      return { available: false, reason: 'Pessoa sem nenhuma identidade externa vinculada ainda.' };
    }

    const providers = aliases.map((alias) => alias.provider);
    const externalIds = aliases.map((alias) => alias.externalUserId);

    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{
        epic_external_id: string | null;
        epic_external_name: string | null;
        semantic_category: string;
        count: string;
      }>(
        `SELECT ewi.epic_external_id, ewi.epic_external_name, ewi.semantic_category, count(*) AS count
         FROM canonical_work_items cwi
         JOIN enriched_work_items ewi ON ewi.id = cwi.id
         JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
           ON pa.provider = cwi.provider AND pa.external_id = cwi.assignee_external_id
         WHERE ewi.is_epic_container = false
         GROUP BY ewi.epic_external_id, ewi.epic_external_name, ewi.semantic_category`,
        [providers, externalIds],
      );

      if (result.rows.length === 0) {
        return { available: false, reason: 'Nenhum work item enriquecido atribuído a essa pessoa ainda.' };
      }

      return { available: true, epics: buildEpicBreakdown(result.rows) };
    });
  }

  /**
   * `completedWorkItems`/`pullRequestsMerged`/`deploymentsTriggered`/
   * `incidentsAssigned` por semana, não cumulativo — mesmo padrão de janela
   * rolante de `TeamProfileService.getProfileHistory`. `completedWorkItems`
   * ganha tempo de vida por categoria (`computeLifetimeStats`, mesma fórmula
   * do time). Busca tudo de uma vez (4 queries, uma por fonte) e bucketiza
   * em JS por ponto, mesmo espírito da resolução em memória do time (volume
   * por pessoa é ainda menor que por time, não justifica SQL com bucket
   * nativo).
   */
  async getProfileHistory(tenantId: string, userId: string, weeks: number): Promise<PersonProfileHistory | null> {
    const user = await this.userRepository.findById(tenantId, userId);
    if (!user) {
      return null;
    }

    const aliases = await this.userProviderAliasRepository.findByUserId(tenantId, userId);

    const now = new Date();
    const pointDates: Date[] = [];
    for (let i = weeks - 1; i >= 0; i -= 1) {
      pointDates.push(new Date(now.getTime() - i * ONE_WEEK_MS));
    }

    // Sem alias nenhum, não tem como achar nada nas fontes canônicas — mesmo
    // caso já tratado em `getProfile` (usuário existe, só não foi vinculado
    // a nenhuma identidade externa ainda).
    if (aliases.length === 0) {
      const emptyPoints = pointDates.map((date) => ({
        date: date.toISOString().slice(0, 10),
        completedWorkItems: [],
        pullRequestsMerged: 0,
        deploymentsTriggered: 0,
        incidentsAssigned: 0,
      }));
      return { points: emptyPoints };
    }

    const providers = aliases.map((alias) => alias.provider);
    const externalIds = aliases.map((alias) => alias.externalUserId);

    return withTenantContext(this.pool, tenantId, async (client) => {
      const [workItemRows, prRows, deploymentRows, incidentRows] = await Promise.all([
        client.query<{
          completed_at: Date | null;
          started_working_at: Date | null;
          semantic_category: string;
        }>(
          `SELECT ewi.completed_at, ewi.started_working_at, ewi.semantic_category
           FROM canonical_work_items cwi
           JOIN enriched_work_items ewi ON ewi.id = cwi.id
           JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
             ON pa.provider = cwi.provider AND pa.external_id = cwi.assignee_external_id`,
          [providers, externalIds],
        ),
        client.query<{ merged_at: Date | null }>(
          `SELECT cpr.merged_at
           FROM canonical_pull_requests cpr
           JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
             ON pa.provider = cpr.provider AND pa.external_id = cpr.author_external_id
           WHERE cpr.state = 'MERGED'`,
          [providers, externalIds],
        ),
        client.query<{ started_at: Date }>(
          `SELECT cd.started_at
           FROM canonical_deployments cd
           JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
             ON pa.provider = cd.provider AND pa.external_id = cd.triggered_by_external_id`,
          [providers, externalIds],
        ),
        client.query<{ triggered_at: Date }>(
          `SELECT ci.triggered_at
           FROM canonical_incidents ci
           JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
             ON pa.provider = ci.provider AND pa.external_id = ci.assignee_external_id`,
          [providers, externalIds],
        ),
      ]);

      const points = pointDates.map((date, index) => {
        const windowStart = index === 0 ? new Date(date.getTime() - ONE_WEEK_MS) : pointDates[index - 1];

        const categoryCounts = new Map<string, number>();
        const categoryLifetimeHours = new Map<string, number[]>();
        for (const row of workItemRows.rows) {
          if (row.completed_at !== null && row.completed_at > windowStart && row.completed_at <= date) {
            categoryCounts.set(row.semantic_category, (categoryCounts.get(row.semantic_category) ?? 0) + 1);
            if (row.started_working_at !== null) {
              const hours = (row.completed_at.getTime() - row.started_working_at.getTime()) / (60 * 60 * 1000);
              const existing = categoryLifetimeHours.get(row.semantic_category);
              if (existing) {
                existing.push(hours);
              } else {
                categoryLifetimeHours.set(row.semantic_category, [hours]);
              }
            }
          }
        }

        const pullRequestsMerged = prRows.rows.filter(
          (row) => row.merged_at !== null && row.merged_at > windowStart && row.merged_at <= date,
        ).length;
        const deploymentsTriggered = deploymentRows.rows.filter(
          (row) => row.started_at > windowStart && row.started_at <= date,
        ).length;
        const incidentsAssigned = incidentRows.rows.filter(
          (row) => row.triggered_at > windowStart && row.triggered_at <= date,
        ).length;

        const completedWorkItems: PersonProfileHistoryCompletedEntry[] = [...categoryCounts.entries()]
          .map(([category, count]) => ({
            category,
            count,
            ...computeLifetimeStats(categoryLifetimeHours.get(category) ?? []),
          }))
          .sort((a, b) => a.category.localeCompare(b.category));

        return { date: date.toISOString().slice(0, 10), completedWorkItems, pullRequestsMerged, deploymentsTriggered, incidentsAssigned };
      });

      return { points };
    });
  }

  /**
   * As 4 fontes canônicas, cada uma casando qualquer uma das identidades
   * externas da pessoa (`unnest` parametrizado — evita N queries, uma por
   * alias) e agrupando por `team_id`, em vez do filtro `team_id = $1` que
   * `TeamProfileService.getContributors` usa. `wip` vem de query própria,
   * separada de `total`/`byCategory` — mesma correção de
   * `TeamProfileService.getContributors` (um `WHERE` de `completed_at`
   * excluiria todo item nunca concluído, que é exatamente o WIP).
   */
  private async queryBreakdownByTeam(
    client: PoolClient,
    providers: readonly string[],
    externalIds: readonly string[],
    period: { readonly from: Date; readonly to: Date } | null,
  ): Promise<Map<string, TeamAccumulator>> {
    const periodFrom = period?.from ?? null;
    const periodTo = period?.to ?? null;

    const [wipRows, workItemRows, prRows, prReviewRows, deploymentRows, incidentRows] = await Promise.all([
      client.query<{ team_id: string | null; wip: string }>(
        `SELECT ewi.team_id, count(*) AS wip
         FROM canonical_work_items cwi
         JOIN enriched_work_items ewi ON ewi.id = cwi.id
         JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
           ON pa.provider = cwi.provider AND pa.external_id = cwi.assignee_external_id
         WHERE ewi.semantic_state = 'IN_PROGRESS'
         GROUP BY ewi.team_id`,
        [providers, externalIds],
      ),
      client.query<{ team_id: string | null; category: string; total: string }>(
        `SELECT ewi.team_id, ewi.semantic_category AS category, count(*) AS total
         FROM canonical_work_items cwi
         JOIN enriched_work_items ewi ON ewi.id = cwi.id
         JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
           ON pa.provider = cwi.provider AND pa.external_id = cwi.assignee_external_id
         WHERE ($3::timestamptz IS NULL OR (ewi.completed_at IS NOT NULL AND ewi.completed_at BETWEEN $3 AND $4))
         GROUP BY ewi.team_id, ewi.semantic_category`,
        [providers, externalIds, periodFrom, periodTo],
      ),
      client.query<{ team_id: string | null; merged: string }>(
        `SELECT trl.team_id, count(*) AS merged
         FROM canonical_pull_requests cpr
         JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
           ON pa.provider = cpr.provider AND pa.external_id = cpr.author_external_id
         LEFT JOIN team_resource_links trl
           ON trl.provider = cpr.provider
           AND trl.resource_type = (CASE cpr.provider WHEN 'github' THEN 'github_repository' WHEN 'azure_repos' THEN 'azure_repos_repository' ELSE NULL END)
           AND trl.external_resource_id = cpr.repository
         WHERE cpr.state = 'MERGED'
           AND ($3::timestamptz IS NULL OR (cpr.merged_at IS NOT NULL AND cpr.merged_at BETWEEN $3 AND $4))
         GROUP BY trl.team_id`,
        [providers, externalIds, periodFrom, periodTo],
      ),
      // Revisor — casa a pessoa contra reviewer_external_ids via = ANY(),
      // não CROSS JOIN LATERAL unnest (diferente de getContributors: aqui
      // já sabemos as identidades da pessoa de antemão, não precisamos
      // enumerar todo mundo que revisou pra depois filtrar em memória).
      // Sem timestamp próprio de revisão — usa merged_at do PR mesmo.
      client.query<{ team_id: string | null; reviewed: string }>(
        `SELECT trl.team_id, count(*) AS reviewed
         FROM canonical_pull_requests cpr
         JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
           ON pa.provider = cpr.provider AND pa.external_id = ANY(cpr.reviewer_external_ids)
         LEFT JOIN team_resource_links trl
           ON trl.provider = cpr.provider
           AND trl.resource_type = (CASE cpr.provider WHEN 'github' THEN 'github_repository' WHEN 'azure_repos' THEN 'azure_repos_repository' ELSE NULL END)
           AND trl.external_resource_id = cpr.repository
         WHERE cpr.state = 'MERGED'
           AND ($3::timestamptz IS NULL OR (cpr.merged_at IS NOT NULL AND cpr.merged_at BETWEEN $3 AND $4))
         GROUP BY trl.team_id`,
        [providers, externalIds, periodFrom, periodTo],
      ),
      client.query<{ team_id: string | null; triggered: string; success: string; failure: string }>(
        `SELECT ed.team_id,
                count(*) AS triggered,
                count(*) FILTER (WHERE cd.status = 'SUCCESS') AS success,
                count(*) FILTER (WHERE cd.status = 'FAILURE') AS failure
         FROM canonical_deployments cd
         JOIN enriched_deployments ed ON ed.id = cd.id
         JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
           ON pa.provider = cd.provider AND pa.external_id = cd.triggered_by_external_id
         WHERE ($3::timestamptz IS NULL OR cd.started_at BETWEEN $3 AND $4)
         GROUP BY ed.team_id`,
        [providers, externalIds, periodFrom, periodTo],
      ),
      client.query<{ team_id: string | null; assigned: string }>(
        `SELECT ei.team_id, count(*) AS assigned
         FROM canonical_incidents ci
         JOIN enriched_incidents ei ON ei.id = ci.id
         JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
           ON pa.provider = ci.provider AND pa.external_id = ci.assignee_external_id
         WHERE ($3::timestamptz IS NULL OR ci.triggered_at BETWEEN $3 AND $4)
         GROUP BY ei.team_id`,
        [providers, externalIds, periodFrom, periodTo],
      ),
    ]);

    const byTeamMap = new Map<string, TeamAccumulator>();

    const resolveAccumulator = (teamId: string | null): TeamAccumulator => {
      const key = teamId ?? UNLINKED_KEY;
      const existing = byTeamMap.get(key);
      if (existing) {
        return existing;
      }

      const created: TeamAccumulator = {
        teamId,
        workItemsTotal: 0,
        workItemsWip: 0,
        workItemsByCategory: {},
        pullRequestsMerged: 0,
        pullRequestsReviewed: 0,
        deploymentsTriggered: 0,
        deploymentsSuccess: 0,
        deploymentsFailure: 0,
        incidentsAssigned: 0,
      };
      byTeamMap.set(key, created);
      return created;
    };

    for (const row of wipRows.rows) {
      resolveAccumulator(row.team_id).workItemsWip += Number(row.wip);
    }
    for (const row of workItemRows.rows) {
      const acc = resolveAccumulator(row.team_id);
      acc.workItemsTotal += Number(row.total);
      acc.workItemsByCategory[row.category] = (acc.workItemsByCategory[row.category] ?? 0) + Number(row.total);
    }
    for (const row of prRows.rows) {
      resolveAccumulator(row.team_id).pullRequestsMerged += Number(row.merged);
    }
    for (const row of prReviewRows.rows) {
      resolveAccumulator(row.team_id).pullRequestsReviewed += Number(row.reviewed);
    }
    for (const row of deploymentRows.rows) {
      const acc = resolveAccumulator(row.team_id);
      acc.deploymentsTriggered += Number(row.triggered);
      acc.deploymentsSuccess += Number(row.success);
      acc.deploymentsFailure += Number(row.failure);
    }
    for (const row of incidentRows.rows) {
      resolveAccumulator(row.team_id).incidentsAssigned += Number(row.assigned);
    }

    return byTeamMap;
  }

  /** Toil da pessoa, sempre mês corrente — mesma janela/filtro de `TeamProfileService`, só casando as identidades dela em vez de filtrar por time. */
  private async queryToilHours(
    client: PoolClient,
    providers: readonly string[],
    externalIds: readonly string[],
  ): Promise<number> {
    const result = await client.query<{ toil_hours: string | null }>(
      `SELECT SUM(EXTRACT(EPOCH FROM (ewi.completed_at - ewi.started_working_at)) / 3600) AS toil_hours
       FROM canonical_work_items cwi
       JOIN enriched_work_items ewi ON ewi.id = cwi.id
       JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
         ON pa.provider = cwi.provider AND pa.external_id = cwi.assignee_external_id
       WHERE ewi.semantic_category = 'TOIL'
         AND ewi.started_working_at IS NOT NULL
         AND ewi.completed_at >= date_trunc('month', NOW())`,
      [providers, externalIds],
    );

    return result.rows[0].toil_hours !== null ? Number(result.rows[0].toil_hours) : 0;
  }
}
