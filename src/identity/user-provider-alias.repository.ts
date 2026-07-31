import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { UserProviderAlias } from './identity.types';

interface UserProviderAliasRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly provider: string;
  readonly external_user_id: string;
  readonly external_username: string | null;
  readonly external_email: string | null;
  readonly is_active: boolean;
  readonly created_at: Date;
}

function mapRowToAlias(row: UserProviderAliasRow): UserProviderAlias {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    provider: row.provider,
    externalUserId: row.external_user_id,
    externalUsername: row.external_username,
    externalEmail: row.external_email,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export interface CreateUserProviderAliasInput {
  readonly provider: string;
  readonly externalUserId: string;
  readonly externalUsername?: string;
  readonly externalEmail?: string;
}

/**
 * Persistência da tabela `user_provider_aliases`
 * (`db/migrations/0009_create_user_provider_aliases.sql`).
 *
 * É a ponte que a Enriched Layer vai usar pra ligar `assignee_external_id`/
 * `author_external_id` da Camada Canônica de volta a um `User` real.
 *
 * Tenant-scoped: toda operação roda dentro de `withTenantContext` (RLS,
 * Seção 4.3 da spec).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 4.1.
 */
export class UserProviderAliasRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(tenantId: string, userId: string, input: CreateUserProviderAliasInput): Promise<UserProviderAlias> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserProviderAliasRow>(
        `INSERT INTO user_provider_aliases (tenant_id, user_id, provider, external_user_id, external_username, external_email)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, tenant_id, user_id, provider, external_user_id, external_username, external_email, is_active, created_at`,
        [tenantId, userId, input.provider, input.externalUserId, input.externalUsername ?? null, input.externalEmail ?? null],
      );

      return mapRowToAlias(result.rows[0]);
    });
  }

  /** Todas as identidades externas vinculadas a um usuário — alimenta `PersonProfileService`. */
  async findByUserId(tenantId: string, userId: string): Promise<readonly UserProviderAlias[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserProviderAliasRow>(
        `SELECT id, tenant_id, user_id, provider, external_user_id, external_username, external_email, is_active, created_at
         FROM user_provider_aliases
         WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId],
      );

      return result.rows.map(mapRowToAlias);
    });
  }

  /**
   * Desfaz um vínculo pessoa↔identidade externa criado errado (mescla
   * acidental via `materialize`/`POST .../aliases`). Não apaga nada da
   * Camada Canônica/Enriquecida — só a ponte; dado histórico já
   * enriquecido com essa identidade permanece como estava até o próximo
   * enriquecimento.
   *
   * @returns `false` se o alias não existe (ou já pertence a outro
   * usuário) neste tenant — não lança.
   */
  async delete(tenantId: string, userId: string, aliasId: string): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM user_provider_aliases WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
        [aliasId, tenantId, userId],
      );

      return (result.rowCount ?? 0) > 0;
    });
  }
}
