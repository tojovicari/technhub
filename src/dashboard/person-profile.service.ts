import { getPool, withTenantContext } from '../database/pool';
import type { Pool, PoolClient } from 'pg';
import { UserRepository } from '../identity/user.repository';
import { UserProviderAliasRepository } from '../identity/user-provider-alias.repository';
import { TeamRepository } from '../identity/team.repository';
import type { User } from '../identity/identity.types';

export interface PersonProfileAlias {
  readonly provider: string;
  readonly externalUserId: string;
  readonly externalUsername: string | null;
}

interface PersonWorkBreakdown {
  readonly workItems: { readonly total: number; readonly wip: number };
  readonly pullRequests: { readonly merged: number };
  readonly deployments: { readonly triggered: number };
  readonly incidents: { readonly assigned: number };
}

export interface PersonProfileTeamBreakdown extends PersonWorkBreakdown {
  /** `null` = contribuição real, mas em recurso ainda não vinculado a nenhum time (não é erro). */
  readonly team: { readonly id: string; readonly name: string } | null;
}

export interface PersonProfile {
  readonly user: Pick<User, 'id' | 'fullName' | 'primaryEmail' | 'avatarUrl' | 'systemRole' | 'status'>;
  readonly aliases: readonly PersonProfileAlias[];
  readonly summary: PersonWorkBreakdown;
  readonly byTeam: readonly PersonProfileTeamBreakdown[];
}

/** Acumulador mutável interno, chaveado por `team_id` (ou `'unlinked'`) — vira `PersonProfileTeamBreakdown` na montagem final. */
interface TeamAccumulator {
  teamId: string | null;
  workItemsTotal: number;
  workItemsWip: number;
  pullRequestsMerged: number;
  deploymentsTriggered: number;
  incidentsAssigned: number;
}

const UNLINKED_KEY = 'unlinked';

function emptyBreakdown(): PersonWorkBreakdown {
  return {
    workItems: { total: 0, wip: 0 },
    pullRequests: { merged: 0 },
    deployments: { triggered: 0 },
    incidents: { assigned: 0 },
  };
}

/**
 * Perfil agregado de uma pessoa — inverso do `TeamProfileService.getContributors`:
 * em vez de "time → pessoas", é "pessoa → tudo que ela tocou, em todos os
 * times". Reaproveita a mesma resolução de identidade (`user_provider_aliases`)
 * e os mesmos padrões de JOIN pra time por fonte canônica, só sem o filtro
 * `team_id = $1` — agrupa por time em vez de filtrar por um só.
 *
 * Sem período (`from`/`to`): mesmo espírito all-time de
 * `deploymentSuccessRate`/`pullRequestReviewHealth`/`contributionConcentration`
 * no perfil de time, que este endpoint mais se parece.
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 6.
 */
export class PersonProfileService {
  constructor(
    private readonly pool: Pool = getPool(),
    private readonly userRepository: UserRepository = new UserRepository(),
    private readonly userProviderAliasRepository: UserProviderAliasRepository = new UserProviderAliasRepository(),
    private readonly teamRepository: TeamRepository = new TeamRepository(),
  ) {}

  async getProfile(tenantId: string, userId: string): Promise<PersonProfile | null> {
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
        provider: alias.provider,
        externalUserId: alias.externalUserId,
        externalUsername: alias.externalUsername,
      })),
    };

    // Sem alias nenhum, não tem como achar nada nas fontes canônicas — evita
    // rodar as 4 queries à toa. Não é erro: usuário existe, só não foi
    // vinculado a nenhuma identidade externa ainda.
    if (aliases.length === 0) {
      return { ...baseProfile, summary: emptyBreakdown(), byTeam: [] };
    }

    const providers = aliases.map((alias) => alias.provider);
    const externalIds = aliases.map((alias) => alias.externalUserId);

    const byTeamMap = await withTenantContext(this.pool, tenantId, (client) =>
      this.queryBreakdownByTeam(client, providers, externalIds),
    );

    const teams = await this.teamRepository.findAllByTenant(tenantId);
    const teamNameById = new Map(teams.map((team) => [team.id, team.name]));

    const byTeam: PersonProfileTeamBreakdown[] = [...byTeamMap.values()]
      .map((acc) => ({
        team: acc.teamId ? { id: acc.teamId, name: teamNameById.get(acc.teamId) ?? acc.teamId } : null,
        workItems: { total: acc.workItemsTotal, wip: acc.workItemsWip },
        pullRequests: { merged: acc.pullRequestsMerged },
        deployments: { triggered: acc.deploymentsTriggered },
        incidents: { assigned: acc.incidentsAssigned },
      }))
      .sort((a, b) => (a.team?.name ?? '').localeCompare(b.team?.name ?? ''));

    const summary = byTeam.reduce<PersonWorkBreakdown>(
      (acc, entry) => ({
        workItems: {
          total: acc.workItems.total + entry.workItems.total,
          wip: acc.workItems.wip + entry.workItems.wip,
        },
        pullRequests: { merged: acc.pullRequests.merged + entry.pullRequests.merged },
        deployments: { triggered: acc.deployments.triggered + entry.deployments.triggered },
        incidents: { assigned: acc.incidents.assigned + entry.incidents.assigned },
      }),
      emptyBreakdown(),
    );

    return { ...baseProfile, summary, byTeam };
  }

  /**
   * As 4 fontes canônicas, cada uma casando qualquer uma das identidades
   * externas da pessoa (`unnest` parametrizado — evita N queries, uma por
   * alias) e agrupando por `team_id`, em vez do filtro `team_id = $1` que
   * `TeamProfileService.getContributors` usa. Combinadas em memória num
   * único acumulador por time, mesmo espírito do `resolveAccumulator` de
   * `getContributors`, só chaveado por time em vez de por pessoa.
   */
  private async queryBreakdownByTeam(
    client: PoolClient,
    providers: readonly string[],
    externalIds: readonly string[],
  ): Promise<Map<string, TeamAccumulator>> {
    const [workItemRows, prRows, deploymentRows, incidentRows] = await Promise.all([
      client.query<{ team_id: string | null; total: string; wip: string }>(
        `SELECT ewi.team_id,
                count(*) AS total,
                count(*) FILTER (WHERE ewi.semantic_state = 'IN_PROGRESS') AS wip
         FROM canonical_work_items cwi
         JOIN enriched_work_items ewi ON ewi.id = cwi.id
         JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
           ON pa.provider = cwi.provider AND pa.external_id = cwi.assignee_external_id
         GROUP BY ewi.team_id`,
        [providers, externalIds],
      ),
      client.query<{ team_id: string | null; merged: string }>(
        `SELECT trl.team_id, count(*) AS merged
         FROM canonical_pull_requests cpr
         JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
           ON pa.provider = 'github' AND pa.external_id = cpr.author_external_id
         LEFT JOIN team_resource_links trl
           ON trl.provider = 'github' AND trl.resource_type = 'github_repository' AND trl.external_resource_id = cpr.repository
         WHERE cpr.state = 'MERGED'
         GROUP BY trl.team_id`,
        [providers, externalIds],
      ),
      client.query<{ team_id: string | null; triggered: string }>(
        `SELECT ed.team_id, count(*) AS triggered
         FROM canonical_deployments cd
         JOIN enriched_deployments ed ON ed.id = cd.id
         JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
           ON pa.provider = cd.provider AND pa.external_id = cd.triggered_by_external_id
         GROUP BY ed.team_id`,
        [providers, externalIds],
      ),
      client.query<{ team_id: string | null; assigned: string }>(
        `SELECT ei.team_id, count(*) AS assigned
         FROM canonical_incidents ci
         JOIN enriched_incidents ei ON ei.id = ci.id
         JOIN unnest($1::text[], $2::text[]) AS pa(provider, external_id)
           ON pa.provider = ci.provider AND pa.external_id = ci.assignee_external_id
         GROUP BY ei.team_id`,
        [providers, externalIds],
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
        pullRequestsMerged: 0,
        deploymentsTriggered: 0,
        incidentsAssigned: 0,
      };
      byTeamMap.set(key, created);
      return created;
    };

    for (const row of workItemRows.rows) {
      const acc = resolveAccumulator(row.team_id);
      acc.workItemsTotal += Number(row.total);
      acc.workItemsWip += Number(row.wip);
    }
    for (const row of prRows.rows) {
      resolveAccumulator(row.team_id).pullRequestsMerged += Number(row.merged);
    }
    for (const row of deploymentRows.rows) {
      resolveAccumulator(row.team_id).deploymentsTriggered += Number(row.triggered);
    }
    for (const row of incidentRows.rows) {
      resolveAccumulator(row.team_id).incidentsAssigned += Number(row.assigned);
    }

    return byTeamMap;
  }
}
