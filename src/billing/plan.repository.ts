import type { Pool } from 'pg';
import { getPool } from '../database/pool';
import type { Plan } from './billing.types';

interface PlanRow {
  readonly id: string;
  readonly name: string;
  readonly display_name: string;
  // NUMERIC/INT vêm do pg como string em alguns drivers — INT vem como number nativo, mas mantemos o padrão de conversão explícita por segurança.
  readonly price_cents: number;
  readonly currency: string;
  readonly billing_period: string;
  readonly stripe_price_id: string | null;
  readonly trial_days: number;
  readonly is_public: boolean;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRowToPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    priceCents: Number(row.price_cents),
    currency: row.currency,
    billingPeriod: row.billing_period,
    stripePriceId: row.stripe_price_id,
    trialDays: Number(row.trial_days),
    isPublic: row.is_public,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PLAN_COLUMNS =
  'id, name, display_name, price_cents, currency, billing_period, stripe_price_id, trial_days, is_public, is_active, created_at, updated_at';

/**
 * Persistência de `plans` (`db/migrations/0024_create_plans.sql`) — catálogo
 * global da plataforma, **sem RLS** (não é dado de tenant).
 */
export class PlanRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /** Usado no provisionamento automático de tenant novo (plano Free). */
  async findByName(name: string): Promise<Plan | null> {
    const result = await this.pool.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM plans WHERE name = $1`, [name]);

    return result.rows.length === 0 ? null : mapRowToPlan(result.rows[0]);
  }

  async findById(id: string): Promise<Plan | null> {
    const result = await this.pool.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1`, [id]);

    return result.rows.length === 0 ? null : mapRowToPlan(result.rows[0]);
  }

  /** Lista pra tela de checkout — só planos públicos e ativos. */
  async findPublicActive(): Promise<readonly Plan[]> {
    const result = await this.pool.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM plans WHERE is_public = TRUE AND is_active = TRUE ORDER BY price_cents`,
    );

    return result.rows.map(mapRowToPlan);
  }
}
