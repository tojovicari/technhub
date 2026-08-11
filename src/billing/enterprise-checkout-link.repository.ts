import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { EnterpriseCheckoutLink, EnterpriseCheckoutLinkStatus } from './billing.types';

interface EnterpriseCheckoutLinkRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly plan_id: string;
  readonly contact_email: string;
  readonly stripe_checkout_session_id: string;
  readonly checkout_url: string;
  readonly status: EnterpriseCheckoutLinkStatus;
  readonly created_by_operator_email: string;
  readonly expires_at: Date;
  readonly paid_at: Date | null;
  readonly created_at: Date;
}

function mapRowToLink(row: EnterpriseCheckoutLinkRow): EnterpriseCheckoutLink {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planId: row.plan_id,
    contactEmail: row.contact_email,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    checkoutUrl: row.checkout_url,
    status: row.status,
    createdByOperatorEmail: row.created_by_operator_email,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

const LINK_COLUMNS =
  'id, tenant_id, plan_id, contact_email, stripe_checkout_session_id, checkout_url, status, created_by_operator_email, expires_at, paid_at, created_at';

export interface CreateEnterpriseCheckoutLinkInput {
  readonly planId: string;
  readonly contactEmail: string;
  readonly stripeCheckoutSessionId: string;
  readonly checkoutUrl: string;
  readonly createdByOperatorEmail: string;
  readonly expiresAt: Date;
}

/**
 * Persistência de `enterprise_checkout_links`
 * (`db/migrations/0051_create_enterprise_checkout_links.sql`) — rastreamento
 * de conversão dos links gerados pelo gestor do SaaS, não fonte de verdade
 * de billing (essa continua sendo `SubscriptionRepository`).
 *
 * `markPaid`/`markExpired` são chamados pelos handlers de webhook do Stripe
 * pra **todo** `checkout.session.completed`/`.expired`, não só os de link
 * enterprise — o `WHERE stripe_checkout_session_id = $2` simplesmente não
 * casa (0 linhas afetadas) pra um checkout self-service normal, sem
 * precisar de `if` no chamador.
 */
export class EnterpriseCheckoutLinkRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(tenantId: string, input: CreateEnterpriseCheckoutLinkInput): Promise<EnterpriseCheckoutLink> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<EnterpriseCheckoutLinkRow>(
        `INSERT INTO enterprise_checkout_links (tenant_id, plan_id, contact_email, stripe_checkout_session_id, checkout_url, created_by_operator_email, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${LINK_COLUMNS}`,
        [
          tenantId,
          input.planId,
          input.contactEmail,
          input.stripeCheckoutSessionId,
          input.checkoutUrl,
          input.createdByOperatorEmail,
          input.expiresAt,
        ],
      );

      return mapRowToLink(result.rows[0]);
    });
  }

  /** Mais recente primeiro. */
  async findAllByTenant(tenantId: string): Promise<readonly EnterpriseCheckoutLink[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<EnterpriseCheckoutLinkRow>(
        `SELECT ${LINK_COLUMNS} FROM enterprise_checkout_links WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );

      return result.rows.map(mapRowToLink);
    });
  }

  /** `true` se uma linha `pending` foi de fato marcada como paga (idempotente — repetir não muda `paid_at`). */
  async markPaid(tenantId: string, stripeCheckoutSessionId: string): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE enterprise_checkout_links
         SET status = 'paid', paid_at = NOW()
         WHERE tenant_id = $1 AND stripe_checkout_session_id = $2 AND status = 'pending'`,
        [tenantId, stripeCheckoutSessionId],
      );

      return (result.rowCount ?? 0) > 0;
    });
  }

  /** `true` se uma linha `pending` foi de fato marcada como expirada. */
  async markExpired(tenantId: string, stripeCheckoutSessionId: string): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE enterprise_checkout_links
         SET status = 'expired'
         WHERE tenant_id = $1 AND stripe_checkout_session_id = $2 AND status = 'pending'`,
        [tenantId, stripeCheckoutSessionId],
      );

      return (result.rowCount ?? 0) > 0;
    });
  }
}
