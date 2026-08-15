import type { Pool } from 'pg';
import { getPool } from '../database/pool';

export interface PlatformTenantNote {
  readonly id: string;
  readonly tenantId: string;
  readonly operatorExternalUserId: string;
  readonly operatorEmail: string;
  readonly body: string;
  readonly createdAt: Date;
}

interface PlatformTenantNoteRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly operator_external_user_id: string;
  readonly operator_email: string;
  readonly body: string;
  readonly created_at: Date;
}

function mapRowToNote(row: PlatformTenantNoteRow): PlatformTenantNote {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    operatorExternalUserId: row.operator_external_user_id,
    operatorEmail: row.operator_email,
    body: row.body,
    createdAt: row.created_at,
  };
}

const NOTE_COLUMNS = 'id, tenant_id, operator_external_user_id, operator_email, body, created_at';

/**
 * Persistência de `platform_tenant_notes` (`db/migrations/0059_create_platform_tenant_notes.sql`)
 * — notas internas de atendimento por tenant, dado da plataforma, sem RLS
 * (mesmo padrão de `PlatformOperatorAuditLogRepository`). Sem `update`: nota
 * errada se apaga e recria, não edita.
 */
export class PlatformTenantNoteRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(
    tenantId: string,
    operatorExternalUserId: string,
    operatorEmail: string,
    body: string,
  ): Promise<PlatformTenantNote> {
    const result = await this.pool.query<PlatformTenantNoteRow>(
      `INSERT INTO platform_tenant_notes (tenant_id, operator_external_user_id, operator_email, body)
       VALUES ($1, $2, $3, $4)
       RETURNING ${NOTE_COLUMNS}`,
      [tenantId, operatorExternalUserId, operatorEmail, body],
    );

    return mapRowToNote(result.rows[0]);
  }

  /** Mais recentes primeiro. */
  async findByTenant(tenantId: string, limit: number): Promise<readonly PlatformTenantNote[]> {
    const result = await this.pool.query<PlatformTenantNoteRow>(
      `SELECT ${NOTE_COLUMNS} FROM platform_tenant_notes
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantId, limit],
    );

    return result.rows.map(mapRowToNote);
  }

  /** `true` se a nota existia neste tenant. */
  async delete(tenantId: string, noteId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM platform_tenant_notes WHERE tenant_id = $1 AND id = $2`,
      [tenantId, noteId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
