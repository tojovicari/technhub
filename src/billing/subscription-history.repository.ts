import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { CreateSubscriptionHistoryInput, SubscriptionHistoryEntry } from './billing.types';

interface SubscriptionHistoryRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly subscription_id: string;
  readonly plan_id: string;
  readonly status: string;
  readonly effective_from: Date;
  readonly reason: string | null;
  readonly created_at: Date;
}

function mapRowToEntry(row: SubscriptionHistoryRow): SubscriptionHistoryEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subscriptionId: row.subscription_id,
    planId: row.plan_id,
    status: row.status,
    effectiveFrom: row.effective_from,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

/**
 * Persistência de `subscription_history`
 * (`db/migrations/0026_create_subscription_history.sql`) — log de eventos
 * (não intervalo). Toda operação roda dentro de `withTenantContext` (RLS).
 */
export class SubscriptionHistoryRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(tenantId: string, input: CreateSubscriptionHistoryInput): Promise<SubscriptionHistoryEntry> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<SubscriptionHistoryRow>(
        `INSERT INTO subscription_history (tenant_id, subscription_id, plan_id, status, reason)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, tenant_id, subscription_id, plan_id, status, effective_from, reason, created_at`,
        [tenantId, input.subscriptionId, input.planId, input.status, input.reason ?? null],
      );

      return mapRowToEntry(result.rows[0]);
    });
  }

  /** Todo o histórico de um tenant, mais antigo primeiro — usado pra métricas cross-tenant (`admin.routes.ts`, funil de conversão). */
  async findAllByTenant(tenantId: string): Promise<readonly SubscriptionHistoryEntry[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<SubscriptionHistoryRow>(
        `SELECT id, tenant_id, subscription_id, plan_id, status, effective_from, reason, created_at
         FROM subscription_history
         WHERE tenant_id = $1
         ORDER BY effective_from ASC`,
        [tenantId],
      );

      return result.rows.map(mapRowToEntry);
    });
  }
}
