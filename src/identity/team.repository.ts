import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { PlanningCycle, Team } from './identity.types';

const DEFAULT_MONTHLY_CAPACITY_HOURS = 160;
const DEFAULT_PLANNING_CYCLE: PlanningCycle = 'MONTHLY';
const DEFAULT_WORKING_DAYS_PER_WEEK = 5;

interface TeamRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  // NUMERIC vem do pg como string (preserva precisão) — convertido no mapeamento.
  readonly default_monthly_capacity_hours: string;
  readonly planning_cycle: PlanningCycle;
  readonly working_days_per_week: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRowToTeam(row: TeamRow): Team {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    defaultMonthlyCapacityHours: Number(row.default_monthly_capacity_hours),
    planningCycle: row.planning_cycle,
    workingDaysPerWeek: row.working_days_per_week,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateTeamInput {
  readonly name: string;
  readonly defaultMonthlyCapacityHours?: number;
  readonly planningCycle?: PlanningCycle;
  readonly workingDaysPerWeek?: number;
}

/** Todos os campos opcionais — `update` só altera o que vier preenchido (semântica de PATCH). */
export interface UpdateTeamInput {
  readonly name?: string;
  readonly defaultMonthlyCapacityHours?: number;
  readonly planningCycle?: PlanningCycle;
  readonly workingDaysPerWeek?: number;
}

/**
 * Persistência da tabela `teams` (`db/migrations/0008_create_teams.sql`).
 *
 * Tenant-scoped: toda operação roda dentro de `withTenantContext` para
 * satisfazer a policy de Row-Level Security da tabela (Seção 4.3 da spec).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 4.1.
 */
export class TeamRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(tenantId: string, input: CreateTeamInput): Promise<Team> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TeamRow>(
        `INSERT INTO teams (tenant_id, name, default_monthly_capacity_hours, planning_cycle, working_days_per_week)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, tenant_id, name, default_monthly_capacity_hours, planning_cycle, working_days_per_week, created_at, updated_at`,
        [
          tenantId,
          input.name,
          input.defaultMonthlyCapacityHours ?? DEFAULT_MONTHLY_CAPACITY_HOURS,
          input.planningCycle ?? DEFAULT_PLANNING_CYCLE,
          input.workingDaysPerWeek ?? DEFAULT_WORKING_DAYS_PER_WEEK,
        ],
      );

      return mapRowToTeam(result.rows[0]);
    });
  }

  /**
   * Atualização parcial (PATCH): só sobrescreve os campos presentes em
   * `input`, via `COALESCE` contra o valor já gravado. `null` quando o time
   * não existe neste tenant.
   */
  async update(tenantId: string, teamId: string, input: UpdateTeamInput): Promise<Team | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TeamRow>(
        `UPDATE teams
         SET name = COALESCE($3, name),
             default_monthly_capacity_hours = COALESCE($4, default_monthly_capacity_hours),
             planning_cycle = COALESCE($5, planning_cycle),
             working_days_per_week = COALESCE($6, working_days_per_week),
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, tenant_id, name, default_monthly_capacity_hours, planning_cycle, working_days_per_week, created_at, updated_at`,
        [
          tenantId,
          teamId,
          input.name ?? null,
          input.defaultMonthlyCapacityHours ?? null,
          input.planningCycle ?? null,
          input.workingDaysPerWeek ?? null,
        ],
      );

      return result.rows.length === 0 ? null : mapRowToTeam(result.rows[0]);
    });
  }

  /** Um único time, ou `null` se não existir neste tenant — usado por `TeamProfileService`. */
  async findById(tenantId: string, teamId: string): Promise<Team | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TeamRow>(
        `SELECT id, tenant_id, name, default_monthly_capacity_hours, planning_cycle, working_days_per_week, created_at, updated_at
         FROM teams
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, teamId],
      );

      return result.rows.length === 0 ? null : mapRowToTeam(result.rows[0]);
    });
  }

  /** Lista todos os times do tenant — usado pela tela de back office. */
  async findAllByTenant(tenantId: string): Promise<readonly Team[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TeamRow>(
        `SELECT id, tenant_id, name, default_monthly_capacity_hours, planning_cycle, working_days_per_week, created_at, updated_at
         FROM teams
         WHERE tenant_id = $1
         ORDER BY name`,
        [tenantId],
      );

      return result.rows.map(mapRowToTeam);
    });
  }

  /** Usado pelo gate de limite de plano (`billing.service.ts`) — mais barato que `findAllByTenant(...).length`. */
  async countByTenant(tenantId: string): Promise<number> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM teams WHERE tenant_id = $1',
        [tenantId],
      );

      return Number(result.rows[0].count);
    });
  }
}
