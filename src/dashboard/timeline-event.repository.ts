import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';

export interface TimelineEvent {
  readonly id: string;
  readonly teamId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly eventDate: Date;
  readonly createdByUserId: string;
  readonly createdByEmail: string;
  readonly createdAt: Date;
}

interface TimelineEventRow {
  id: string;
  team_id: string | null;
  title: string;
  description: string | null;
  event_date: Date;
  created_by_user_id: string;
  created_by_email: string;
  created_at: Date;
}

function mapRowToEvent(row: TimelineEventRow): TimelineEvent {
  return {
    id: row.id,
    teamId: row.team_id,
    title: row.title,
    description: row.description,
    eventDate: row.event_date,
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
  };
}

/**
 * Eventos manuais (desligamento, troca de versão, reorg...) pra sobrepor
 * como marcador visual em qualquer gráfico temporal — sem correlação
 * automática com métrica nenhuma (ver migration 0061). `createdByEmail` via
 * JOIN em `users`, mesmo padrão de `TeamMetricConfigHistoryRepository`.
 */
export class TimelineEventRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(
    tenantId: string,
    input: {
      readonly teamId: string | null;
      readonly title: string;
      readonly description: string | null;
      readonly eventDate: Date;
      readonly createdByUserId: string;
    },
  ): Promise<TimelineEvent> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TimelineEventRow>(
        `WITH inserted AS (
           INSERT INTO timeline_events (tenant_id, team_id, title, description, event_date, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, team_id, title, description, event_date, created_by_user_id, created_at
         )
         SELECT inserted.id, inserted.team_id, inserted.title, inserted.description, inserted.event_date,
                inserted.created_by_user_id, u.primary_email AS created_by_email, inserted.created_at
         FROM inserted
         JOIN users u ON u.id = inserted.created_by_user_id`,
        [tenantId, input.teamId, input.title, input.description, input.eventDate, input.createdByUserId],
      );

      return mapRowToEvent(result.rows[0]);
    });
  }

  /**
   * `teamId: null` → só eventos de organização (mesmo comportamento de
   * `TeamMetricConfigHistoryRepository.findChangesInRange`). Com `teamId`,
   * mescla organização + time (`team_id IS NULL OR team_id = $2`).
   */
  async findInRange(tenantId: string, teamId: string | null, from: Date, to: Date): Promise<readonly TimelineEvent[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<TimelineEventRow>(
        `SELECT e.id, e.team_id, e.title, e.description, e.event_date,
                e.created_by_user_id, u.primary_email AS created_by_email, e.created_at
         FROM timeline_events e
         JOIN users u ON u.id = e.created_by_user_id
         WHERE e.tenant_id = $1
           AND (e.team_id IS NULL OR e.team_id = $2)
           AND e.event_date BETWEEN $3 AND $4
         ORDER BY e.event_date ASC`,
        [tenantId, teamId, from, to],
      );

      return result.rows.map(mapRowToEvent);
    });
  }

  /** `false` se o `id` não existe (ou não pertence a esse tenant). */
  async delete(tenantId: string, eventId: string): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(`DELETE FROM timeline_events WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        eventId,
      ]);

      return (result.rowCount ?? 0) > 0;
    });
  }
}
