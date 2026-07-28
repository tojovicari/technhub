import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { BillingEvent, CreateBillingEventInput } from './billing.types';

interface BillingEventRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly event_type: string;
  readonly provider: string | null;
  readonly provider_event_id: string | null;
  readonly raw_payload: unknown;
  readonly occurred_at: Date;
  readonly created_at: Date;
}

function mapRowToBillingEvent(row: BillingEventRow): BillingEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    rawPayload: row.raw_payload,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

/**
 * Persistência de `billing_events`
 * (`db/migrations/0027_create_billing_events.sql`) — auditoria +
 * idempotência de webhook do Stripe. Toda operação roda dentro de
 * `withTenantContext` (RLS) — quem chama já precisa saber o `tenantId`
 * (resolvido via `metadata.tenantId` do Stripe ou via
 * `StripeSubscriptionIndexRepository`, nunca por uma consulta cross-tenant
 * a esta própria tabela).
 */
export class BillingEventRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(tenantId: string, input: CreateBillingEventInput): Promise<BillingEvent> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<BillingEventRow>(
        `INSERT INTO billing_events (tenant_id, event_type, provider, provider_event_id, raw_payload)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, tenant_id, event_type, provider, provider_event_id, raw_payload, occurred_at, created_at`,
        [
          tenantId,
          input.eventType,
          input.provider ?? null,
          input.providerEventId ?? null,
          input.rawPayload ? JSON.stringify(input.rawPayload) : null,
        ],
      );

      return mapRowToBillingEvent(result.rows[0]);
    });
  }

  /** Idempotência: um `providerEventId` (Stripe `event.id`) já processado não deve ser reprocessado. */
  async existsByProviderEventId(tenantId: string, providerEventId: string): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT 1 FROM billing_events WHERE tenant_id = $1 AND provider_event_id = $2`,
        [tenantId, providerEventId],
      );

      return result.rows.length > 0;
    });
  }
}
