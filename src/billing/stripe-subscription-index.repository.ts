import type { Pool } from 'pg';
import { getPool } from '../database/pool';

/**
 * Persistência de `stripe_subscription_index`
 * (`db/migrations/0028_create_stripe_subscription_index.sql`) — índice sem
 * RLS que resolve `providerSubscriptionId → tenantId` pros handlers de
 * webhook que não recebem o tenant diretamente do Stripe. Ver comentário na
 * migration pro raciocínio completo.
 */
export class StripeSubscriptionIndexRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async upsert(providerSubscriptionId: string, tenantId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO stripe_subscription_index (provider_subscription_id, tenant_id)
       VALUES ($1, $2)
       ON CONFLICT (provider_subscription_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`,
      [providerSubscriptionId, tenantId],
    );
  }

  async findTenantId(providerSubscriptionId: string): Promise<string | null> {
    const result = await this.pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM stripe_subscription_index WHERE provider_subscription_id = $1`,
      [providerSubscriptionId],
    );

    return result.rows.length === 0 ? null : result.rows[0].tenant_id;
  }
}
