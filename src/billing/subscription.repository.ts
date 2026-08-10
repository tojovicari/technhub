import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { Subscription, SubscriptionStatus, UpdateSubscriptionInput } from './billing.types';

interface SubscriptionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly plan_id: string;
  readonly status: SubscriptionStatus;
  readonly trial_ends_at: Date | null;
  readonly current_period_start: Date;
  readonly current_period_end: Date;
  readonly past_due_since: Date | null;
  readonly cancelled_at: Date | null;
  readonly provider: string | null;
  readonly provider_customer_id: string | null;
  readonly provider_subscription_id: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRowToSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planId: row.plan_id,
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    pastDueSince: row.past_due_since,
    cancelledAt: row.cancelled_at,
    provider: row.provider,
    providerCustomerId: row.provider_customer_id,
    providerSubscriptionId: row.provider_subscription_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SUBSCRIPTION_COLUMNS =
  'id, tenant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end, past_due_since, cancelled_at, provider, provider_customer_id, provider_subscription_id, created_at, updated_at';

export interface CreateSubscriptionInput {
  readonly planId: string;
  readonly status?: SubscriptionStatus;
  readonly trialEndsAt?: Date;
}

/**
 * Persistência de `subscriptions` (`db/migrations/0025_create_subscriptions.sql`)
 * — 1:1 por tenant. Toda operação roda dentro de `withTenantContext` (RLS,
 * Seção 4.3 da spec).
 */
export class SubscriptionRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(tenantId: string, input: CreateSubscriptionInput): Promise<Subscription> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<SubscriptionRow>(
        `INSERT INTO subscriptions (tenant_id, plan_id, status, trial_ends_at)
         VALUES ($1, $2, $3, $4)
         RETURNING ${SUBSCRIPTION_COLUMNS}`,
        [tenantId, input.planId, input.status ?? 'active', input.trialEndsAt ?? null],
      );

      return mapRowToSubscription(result.rows[0]);
    });
  }

  async findByTenantId(tenantId: string): Promise<Subscription | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<SubscriptionRow>(
        `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE tenant_id = $1`,
        [tenantId],
      );

      return result.rows.length === 0 ? null : mapRowToSubscription(result.rows[0]);
    });
  }

  /**
   * Colunas atualizáveis via `update` — chave é a coluna SQL, valor é o
   * campo correspondente em `UpdateSubscriptionInput`.
   */
  private static readonly UPDATABLE_COLUMNS: Record<string, keyof UpdateSubscriptionInput> = {
    plan_id: 'planId',
    status: 'status',
    trial_ends_at: 'trialEndsAt',
    current_period_start: 'currentPeriodStart',
    current_period_end: 'currentPeriodEnd',
    past_due_since: 'pastDueSince',
    cancelled_at: 'cancelledAt',
    provider: 'provider',
    provider_customer_id: 'providerCustomerId',
    provider_subscription_id: 'providerSubscriptionId',
  };

  /**
   * Atualização parcial (PATCH): só sobrescreve os campos **presentes** em
   * `input` (`key in input`, não `input[key] ?? null`) — distingue "campo
   * ausente" (não mexe) de "campo explicitamente `null`" (limpa a coluna).
   * `pastDueSince`/`cancelledAt` são `Date | null` de propósito
   * (`billing.types.ts`) justamente pra suportar "voltar a ficar `null`"
   * quando uma assinatura se recupera de `past_due` ou tem o cancelamento
   * desfeito — um `COALESCE($N, coluna)` contra `input.campo ?? null` não
   * consegue expressar isso (`COALESCE(NULL, coluna)` sempre devolve o
   * valor antigo, nunca limpa). Bug real encontrado numa auditoria de
   * documentação: `onInvoicePaid`/`resumeSubscription` já tentavam limpar
   * esses campos passando `null` explícito, mas a coluna nunca de fato
   * zerava — `status` corrigia certo, os timestamps ficavam obsoletos.
   */
  async update(tenantId: string, input: UpdateSubscriptionInput): Promise<Subscription | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const params: unknown[] = [tenantId];
      const setClauses: string[] = [];

      for (const [column, field] of Object.entries(SubscriptionRepository.UPDATABLE_COLUMNS)) {
        if (field in input) {
          params.push(input[field]);
          setClauses.push(`${column} = $${params.length}`);
        }
      }
      setClauses.push('updated_at = NOW()');

      const result = await client.query<SubscriptionRow>(
        `UPDATE subscriptions
         SET ${setClauses.join(', ')}
         WHERE tenant_id = $1
         RETURNING ${SUBSCRIPTION_COLUMNS}`,
        params,
      );

      return result.rows.length === 0 ? null : mapRowToSubscription(result.rows[0]);
    });
  }
}
