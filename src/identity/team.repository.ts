import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { PlanningCycle, Team, TeamStatus } from './identity.types';

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
  readonly status: TeamStatus;
  readonly archived_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const TEAM_COLUMNS =
  'id, tenant_id, name, default_monthly_capacity_hours, planning_cycle, working_days_per_week, status, archived_at, created_at, updated_at';

function mapRowToTeam(row: TeamRow): Team {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    defaultMonthlyCapacityHours: Number(row.default_monthly_capacity_hours),
    planningCycle: row.planning_cycle,
    workingDaysPerWeek: row.working_days_per_week,
    status: row.status,
    archivedAt: row.archived_at,
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
         RETURNING ${TEAM_COLUMNS}`,
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
         RETURNING ${TEAM_COLUMNS}`,
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
        `SELECT ${TEAM_COLUMNS}
         FROM teams
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, teamId],
      );

      return result.rows.length === 0 ? null : mapRowToTeam(result.rows[0]);
    });
  }

  /**
   * Lista todos os times do tenant, **inclusive arquivados** — usado pela
   * tela de back office e por outros consumidores internos (sync, admin,
   * pessoas) que não deveriam perder visibilidade de um time arquivado.
   * Esconder arquivado por padrão é responsabilidade da rota
   * (`GET /tenants/:tenantId/teams`, `?includeArchived=`), não deste método.
   */
  async findAllByTenant(tenantId: string): Promise<readonly Team[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TeamRow>(
        `SELECT ${TEAM_COLUMNS}
         FROM teams
         WHERE tenant_id = $1
         ORDER BY name`,
        [tenantId],
      );

      return result.rows.map(mapRowToTeam);
    });
  }

  /**
   * Arquiva um time (soft delete) — flip de status puro, não apaga nem
   * guarda nada. `null` se o time não existe neste tenant ou já está
   * `ARCHIVED` (nada a arquivar de novo).
   */
  async archive(tenantId: string, teamId: string): Promise<Team | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TeamRow>(
        `UPDATE teams
         SET status = 'ARCHIVED', archived_at = NOW(), updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
         RETURNING ${TEAM_COLUMNS}`,
        [tenantId, teamId],
      );

      return result.rows.length === 0 ? null : mapRowToTeam(result.rows[0]);
    });
  }

  /**
   * Reativa um time arquivado. `archived_at` não é limpo — fica como
   * registro histórico do último arquivamento. `null` se o time não
   * existe neste tenant ou não está `ARCHIVED`.
   */
  async unarchive(tenantId: string, teamId: string): Promise<Team | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TeamRow>(
        `UPDATE teams
         SET status = 'ACTIVE', updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 AND status = 'ARCHIVED'
         RETURNING ${TEAM_COLUMNS}`,
        [tenantId, teamId],
      );

      return result.rows.length === 0 ? null : mapRowToTeam(result.rows[0]);
    });
  }

  /**
   * Usado pelo gate de limite de plano (`billing.service.ts`/`teams.routes.ts`)
   * — mais barato que `findAllByTenant(...).length`. Só conta times
   * `ACTIVE`: arquivar libera a vaga do plano.
   */
  async countByTenant(tenantId: string): Promise<number> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM teams WHERE tenant_id = $1 AND status = 'ACTIVE'",
        [tenantId],
      );

      return Number(result.rows[0].count);
    });
  }
}
