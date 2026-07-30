import type { Pool } from 'pg';
import { getPool } from '../database/pool';
import type { Tenant, TenantStatus } from './identity.types';

interface TenantRow {
  readonly id: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRowToTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateTenantInput {
  readonly name: string;
}

/**
 * Persistência da tabela `tenants` (`db/migrations/0003_create_tenants.sql`).
 *
 * `tenants` é a raiz do isolamento multi-tenant — não é, ela própria,
 * tenant-scoped, então não tem RLS e não precisa de `withTenantContext`.
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 4.1.
 */
export class TenantRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(input: CreateTenantInput): Promise<Tenant> {
    const result = await this.pool.query<TenantRow>(
      `INSERT INTO tenants (name)
       VALUES ($1)
       RETURNING id, name, status, created_at, updated_at`,
      [input.name],
    );

    return mapRowToTenant(result.rows[0]);
  }

  /** Usado pelo login SSO-first pra mostrar nome dos tenants candidatos (ver `auth.routes.ts`). */
  async findManyByIds(ids: readonly string[]): Promise<readonly Tenant[]> {
    if (ids.length === 0) {
      return [];
    }

    const result = await this.pool.query<TenantRow>(
      `SELECT id, name, status, created_at, updated_at FROM tenants WHERE id = ANY($1::uuid[])`,
      [ids],
    );

    return result.rows.map(mapRowToTenant);
  }

  /** Usado pelo scheduler de sync (`POST /internal/sync`) — só tenants ativos entram no loop automático. */
  async findAllActive(): Promise<readonly Tenant[]> {
    const result = await this.pool.query<TenantRow>(
      `SELECT id, name, status, created_at, updated_at FROM tenants WHERE status = 'ACTIVE'`,
    );

    return result.rows.map(mapRowToTenant);
  }
}
