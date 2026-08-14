import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';

/** Providers cujos recursos externos podem ser vinculados a um time. */
export type ExternalResourceProvider =
  | 'waroom'
  | 'github'
  | 'jira'
  | 'linear'
  | 'argocd'
  | 'azure_boards'
  | 'azure_repos'
  | 'azure_pipelines';

/** Tipo de recurso externo vinculável — cada um pertence a um único `ExternalResourceProvider`. */
export type ExternalResourceType =
  | 'waroom_team'
  | 'github_repository'
  | 'jira_project'
  | 'linear_team'
  | 'argocd_project'
  | 'azure_boards_project'
  | 'azure_repos_repository'
  | 'azure_pipelines_project';

export interface TeamResourceLink {
  readonly id: string;
  readonly tenantId: string;
  readonly teamId: string;
  readonly provider: ExternalResourceProvider;
  readonly resourceType: ExternalResourceType;
  readonly externalResourceId: string;
  readonly externalResourceName: string | null;
  readonly createdAt: Date;
}

export interface CreateTeamResourceLinkInput {
  readonly provider: ExternalResourceProvider;
  readonly resourceType: ExternalResourceType;
  readonly externalResourceId: string;
  readonly externalResourceName?: string;
}

interface TeamResourceLinkRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly team_id: string;
  readonly provider: ExternalResourceProvider;
  readonly resource_type: ExternalResourceType;
  readonly external_resource_id: string;
  readonly external_resource_name: string | null;
  readonly created_at: Date;
}

function mapRowToLink(row: TeamResourceLinkRow): TeamResourceLink {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    teamId: row.team_id,
    provider: row.provider,
    resourceType: row.resource_type,
    externalResourceId: row.external_resource_id,
    externalResourceName: row.external_resource_name,
    createdAt: row.created_at,
  };
}

/**
 * Persistência de `team_resource_links`
 * (`db/migrations/0023_create_team_resource_links.sql`) — vínculo manual de
 * um recurso externo (time do Waroom, repositório do GitHub) a um time da
 * plataforma. Mesmo espírito de `user_provider_aliases`, mas pra recurso em
 * vez de pessoa.
 *
 * Toda operação roda dentro de `withTenantContext` (RLS, Seção 4.3 da spec).
 */
export class TeamResourceLinkRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(tenantId: string, teamId: string, input: CreateTeamResourceLinkInput): Promise<TeamResourceLink> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TeamResourceLinkRow>(
        `INSERT INTO team_resource_links (tenant_id, team_id, provider, resource_type, external_resource_id, external_resource_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, tenant_id, team_id, provider, resource_type, external_resource_id, external_resource_name, created_at`,
        [
          tenantId,
          teamId,
          input.provider,
          input.resourceType,
          input.externalResourceId,
          input.externalResourceName ?? null,
        ],
      );

      return mapRowToLink(result.rows[0]);
    });
  }

  /** Lista os vínculos já criados pra um time — tela de admin ver/editar. */
  async findByTeam(tenantId: string, teamId: string): Promise<readonly TeamResourceLink[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TeamResourceLinkRow>(
        `SELECT id, tenant_id, team_id, provider, resource_type, external_resource_id, external_resource_name, created_at
         FROM team_resource_links
         WHERE tenant_id = $1 AND team_id = $2
         ORDER BY external_resource_name NULLS LAST, external_resource_id`,
        [tenantId, teamId],
      );

      return result.rows.map(mapRowToLink);
    });
  }

  /** Remove um vínculo — o recurso externo volta a aparecer em `GET .../candidates`. `false` se o `id` não existe (ou não pertence a esse tenant/time). */
  async delete(tenantId: string, teamId: string, linkId: string): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM team_resource_links WHERE tenant_id = $1 AND team_id = $2 AND id = $3`,
        [tenantId, teamId, linkId],
      );

      return (result.rowCount ?? 0) > 0;
    });
  }

  /**
   * `external_resource_id → team_id` pra um provider+tipo — carregado uma
   * vez por execução (enriquecimento/dashboard) pra evitar N+1 ao resolver
   * o time de cada registro individualmente.
   */
  async findMapByProviderAndType(
    tenantId: string,
    provider: ExternalResourceProvider,
    resourceType: ExternalResourceType,
  ): Promise<ReadonlyMap<string, string>> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ external_resource_id: string; team_id: string }>(
        `SELECT external_resource_id, team_id
         FROM team_resource_links
         WHERE tenant_id = $1 AND provider = $2 AND resource_type = $3`,
        [tenantId, provider, resourceType],
      );

      return new Map(result.rows.map((row) => [row.external_resource_id, row.team_id]));
    });
  }
}
