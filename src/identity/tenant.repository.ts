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
}
