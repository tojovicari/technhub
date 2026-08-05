import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { TeamMembership } from './identity.types';

const DEFAULT_ROLE_IN_TEAM = 'DEVELOPER';
const DEFAULT_CAPACITY_ALLOCATION_PERCENT = 100;

interface TeamMembershipRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly team_id: string;
  readonly role_in_team: string;
  // NUMERIC vem do pg como string — convertido no mapeamento.
  readonly capacity_allocation_percent: string;
  readonly custom_monthly_capacity_hours: string | null;
  readonly joined_at: Date;
}

function mapRowToTeamMembership(row: TeamMembershipRow): TeamMembership {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    teamId: row.team_id,
    roleInTeam: row.role_in_team,
    capacityAllocationPercent: Number(row.capacity_allocation_percent),
    customMonthlyCapacityHours:
      row.custom_monthly_capacity_hours === null ? null : Number(row.custom_monthly_capacity_hours),
    joinedAt: row.joined_at,
  };
}

export interface CreateTeamMembershipInput {
  readonly userId: string;
  readonly roleInTeam?: string;
  readonly capacityAllocationPercent?: number;
  readonly customMonthlyCapacityHours?: number;
}

/**
 * Todos os campos opcionais — `update` só altera o que vier preenchido
 * (semântica de PATCH). Não dá pra usar isto pra *limpar*
 * `customMonthlyCapacityHours` de volta pra `null` (voltar a usar a
 * capacidade default do time) — só pra defini-lo; limpar exigiria um
 * endpoint/semântica à parte, fora do escopo desta rodada.
 */
export interface UpdateTeamMembershipInput {
  readonly roleInTeam?: string;
  readonly capacityAllocationPercent?: number;
  readonly customMonthlyCapacityHours?: number;
}

export interface TeamMembershipWithUser {
  readonly membership: TeamMembership;
  readonly user: {
    readonly id: string;
    readonly fullName: string;
    readonly primaryEmail: string;
    readonly avatarUrl: string | null;
  };
}

interface TeamMembershipWithUserRow extends TeamMembershipRow {
  readonly user_full_name: string;
  readonly user_primary_email: string;
  readonly user_avatar_url: string | null;
}

function mapRowToTeamMembershipWithUser(row: TeamMembershipWithUserRow): TeamMembershipWithUser {
  return {
    membership: mapRowToTeamMembership(row),
    user: {
      id: row.user_id,
      fullName: row.user_full_name,
      primaryEmail: row.user_primary_email,
      avatarUrl: row.user_avatar_url,
    },
  };
}

/**
 * Persistência da tabela `team_memberships` (`db/migrations/0010_create_team_memberships.sql`).
 *
 * Tenant-scoped: toda operação roda dentro de `withTenantContext` (RLS,
 * Seção 4.3 da spec).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 4.1.
 */
export class TeamMembershipRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(tenantId: string, teamId: string, input: CreateTeamMembershipInput): Promise<TeamMembership> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TeamMembershipRow>(
        `INSERT INTO team_memberships (tenant_id, user_id, team_id, role_in_team, capacity_allocation_percent, custom_monthly_capacity_hours)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, tenant_id, user_id, team_id, role_in_team, capacity_allocation_percent, custom_monthly_capacity_hours, joined_at`,
        [
          tenantId,
          input.userId,
          teamId,
          input.roleInTeam ?? DEFAULT_ROLE_IN_TEAM,
          input.capacityAllocationPercent ?? DEFAULT_CAPACITY_ALLOCATION_PERCENT,
          input.customMonthlyCapacityHours ?? null,
        ],
      );

      return mapRowToTeamMembership(result.rows[0]);
    });
  }

  /**
   * Atualização parcial (PATCH): só sobrescreve os campos presentes em
   * `input`, via `COALESCE` contra o valor já gravado. `null` quando a
   * membership não existe neste tenant/time.
   */
  async update(
    tenantId: string,
    teamId: string,
    membershipId: string,
    input: UpdateTeamMembershipInput,
  ): Promise<TeamMembership | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TeamMembershipRow>(
        `UPDATE team_memberships
         SET role_in_team = COALESCE($4, role_in_team),
             capacity_allocation_percent = COALESCE($5, capacity_allocation_percent),
             custom_monthly_capacity_hours = COALESCE($6, custom_monthly_capacity_hours)
         WHERE tenant_id = $1 AND team_id = $2 AND id = $3
         RETURNING id, tenant_id, user_id, team_id, role_in_team, capacity_allocation_percent, custom_monthly_capacity_hours, joined_at`,
        [
          tenantId,
          teamId,
          membershipId,
          input.roleInTeam ?? null,
          input.capacityAllocationPercent ?? null,
          input.customMonthlyCapacityHours ?? null,
        ],
      );

      return result.rows.length === 0 ? null : mapRowToTeamMembership(result.rows[0]);
    });
  }

  /**
   * Todas as memberships de uma pessoa, com a capacidade default do
   * respectivo time já embutida — usado por `PersonProfileService` pra
   * somar a capacidade própria da pessoa (soma de todas as memberships,
   * cada uma com `customMonthlyCapacityHours ?? team.defaultMonthlyCapacityHours`
   * escalado por `capacityAllocationPercent`), mesma fórmula de
   * `TeamProfileService.computeToilRatio`, só que por pessoa em vez de por
   * time inteiro.
   */
  async findByUserId(
    tenantId: string,
    userId: string,
  ): Promise<readonly { readonly teamId: string; readonly capacityAllocationPercent: number; readonly customMonthlyCapacityHours: number | null; readonly teamDefaultMonthlyCapacityHours: number }[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{
        team_id: string;
        capacity_allocation_percent: string;
        custom_monthly_capacity_hours: string | null;
        team_default_monthly_capacity_hours: string;
      }>(
        `SELECT tm.team_id, tm.capacity_allocation_percent, tm.custom_monthly_capacity_hours,
                t.default_monthly_capacity_hours AS team_default_monthly_capacity_hours
         FROM team_memberships tm
         JOIN teams t ON t.id = tm.team_id
         WHERE tm.tenant_id = $1 AND tm.user_id = $2`,
        [tenantId, userId],
      );

      return result.rows.map((row) => ({
        teamId: row.team_id,
        capacityAllocationPercent: Number(row.capacity_allocation_percent),
        customMonthlyCapacityHours: row.custom_monthly_capacity_hours === null ? null : Number(row.custom_monthly_capacity_hours),
        teamDefaultMonthlyCapacityHours: Number(row.team_default_monthly_capacity_hours),
      }));
    });
  }

  /** Lista os membros de um time, com dados básicos do usuário — usado pela tela de back office. */
  async findByTeamWithUser(tenantId: string, teamId: string): Promise<readonly TeamMembershipWithUser[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TeamMembershipWithUserRow>(
        `SELECT
           tm.id, tm.tenant_id, tm.user_id, tm.team_id, tm.role_in_team,
           tm.capacity_allocation_percent, tm.custom_monthly_capacity_hours, tm.joined_at,
           u.full_name AS user_full_name, u.primary_email AS user_primary_email, u.avatar_url AS user_avatar_url
         FROM team_memberships tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.tenant_id = $1 AND tm.team_id = $2
         ORDER BY u.full_name`,
        [tenantId, teamId],
      );

      return result.rows.map(mapRowToTeamMembershipWithUser);
    });
  }
}
