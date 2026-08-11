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
  readonly max_users: number | null;
  readonly max_teams: number | null;
  readonly max_integrations: number | null;
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
    maxUsers: row.max_users === null ? null : Number(row.max_users),
    maxTeams: row.max_teams === null ? null : Number(row.max_teams),
    maxIntegrations: row.max_integrations === null ? null : Number(row.max_integrations),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PLAN_COLUMNS =
  'id, name, display_name, price_cents, currency, billing_period, stripe_price_id, trial_days, is_public, is_active, max_users, max_teams, max_integrations, created_at, updated_at';

export interface CreatePlanInput {
  readonly name: string;
  readonly displayName: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly billingPeriod: string;
  /** `null` pra plano gratuito — mesma convenção do seed do plano Free (nunca cria Price no Stripe). */
  readonly stripePriceId: string | null;
  readonly trialDays: number;
  readonly isPublic: boolean;
  readonly isActive: boolean;
  /** `null`/omitido = ilimitado. Nenhum dos três é obrigatório ao criar plano. */
  readonly maxUsers?: number | null;
  readonly maxTeams?: number | null;
  readonly maxIntegrations?: number | null;
}

/** Campo omitido preserva o valor atual — mesmo padrão de `ProviderIntegrationRepository.update`. `stripePriceId: null` explícito limpa o campo (diferente de omitido); mesma convenção pros 3 campos de limite (`null` explícito = "virou ilimitado"). */
export interface UpdatePlanInput {
  readonly displayName?: string;
  readonly priceCents?: number;
  readonly currency?: string;
  readonly billingPeriod?: string;
  readonly stripePriceId?: string | null;
  readonly trialDays?: number;
  readonly isPublic?: boolean;
  readonly isActive?: boolean;
  readonly maxUsers?: number | null;
  readonly maxTeams?: number | null;
  readonly maxIntegrations?: number | null;
}

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

  /** Todos os planos, inclusive privados/inativos — usado pelo painel do gestor do SaaS (`admin.routes.ts`), diferente de `findPublicActive`. */
  async findAll(): Promise<readonly Plan[]> {
    const result = await this.pool.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM plans ORDER BY price_cents`);

    return result.rows.map(mapRowToPlan);
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    const result = await this.pool.query<PlanRow>(
      `INSERT INTO plans (name, display_name, price_cents, currency, billing_period, stripe_price_id, trial_days, is_public, is_active, max_users, max_teams, max_integrations)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${PLAN_COLUMNS}`,
      [
        input.name,
        input.displayName,
        input.priceCents,
        input.currency,
        input.billingPeriod,
        input.stripePriceId,
        input.trialDays,
        input.isPublic,
        input.isActive,
        input.maxUsers ?? null,
        input.maxTeams ?? null,
        input.maxIntegrations ?? null,
      ],
    );

    return mapRowToPlan(result.rows[0]);
  }

  /** Campo omitido (`undefined`) preserva o valor atual. `null` em `stripePriceId` limpa o campo de propósito. `null` se o plano não existe. */
  async update(id: string, patch: UpdatePlanInput): Promise<Plan | null> {
    const result = await this.pool.query<PlanRow>(
      `UPDATE plans SET
         display_name = CASE WHEN $2::boolean THEN $3::varchar ELSE display_name END,
         price_cents = CASE WHEN $4::boolean THEN $5::int ELSE price_cents END,
         currency = CASE WHEN $6::boolean THEN $7::varchar ELSE currency END,
         billing_period = CASE WHEN $8::boolean THEN $9::varchar ELSE billing_period END,
         stripe_price_id = CASE WHEN $10::boolean THEN $11::varchar ELSE stripe_price_id END,
         trial_days = CASE WHEN $12::boolean THEN $13::int ELSE trial_days END,
         is_public = CASE WHEN $14::boolean THEN $15::boolean ELSE is_public END,
         is_active = CASE WHEN $16::boolean THEN $17::boolean ELSE is_active END,
         max_users = CASE WHEN $18::boolean THEN $19::int ELSE max_users END,
         max_teams = CASE WHEN $20::boolean THEN $21::int ELSE max_teams END,
         max_integrations = CASE WHEN $22::boolean THEN $23::int ELSE max_integrations END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING ${PLAN_COLUMNS}`,
      [
        id,
        patch.displayName !== undefined,
        patch.displayName ?? null,
        patch.priceCents !== undefined,
        patch.priceCents ?? null,
        patch.currency !== undefined,
        patch.currency ?? null,
        patch.billingPeriod !== undefined,
        patch.billingPeriod ?? null,
        patch.stripePriceId !== undefined,
        patch.stripePriceId ?? null,
        patch.trialDays !== undefined,
        patch.trialDays ?? null,
        patch.isPublic !== undefined,
        patch.isPublic ?? null,
        patch.isActive !== undefined,
        patch.isActive ?? null,
        patch.maxUsers !== undefined,
        patch.maxUsers ?? null,
        patch.maxTeams !== undefined,
        patch.maxTeams ?? null,
        patch.maxIntegrations !== undefined,
        patch.maxIntegrations ?? null,
      ],
    );

    return result.rows.length === 0 ? null : mapRowToPlan(result.rows[0]);
  }
}
