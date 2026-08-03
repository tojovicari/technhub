import type { Pool } from 'pg';
import { getPool } from '../database/pool';

export type PlatformOperatorAuditAction =
  | 'SUSPEND_TENANT'
  | 'REACTIVATE_TENANT'
  | 'CANCEL_SUBSCRIPTION'
  | 'CREATE_PLAN'
  | 'UPDATE_PLAN'
  | 'START_IMPERSONATION'
  | 'END_IMPERSONATION';

export interface PlatformOperatorAuditLogEntry {
  readonly id: string;
  readonly operatorExternalUserId: string;
  readonly operatorEmail: string;
  readonly action: PlatformOperatorAuditAction;
  readonly targetTenantId: string | null;
  readonly targetUserId: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: Date;
}

export interface RecordAuditLogInput {
  readonly operatorExternalUserId: string;
  readonly operatorEmail: string;
  readonly action: PlatformOperatorAuditAction;
  readonly targetTenantId?: string | null;
  readonly targetUserId?: string | null;
  readonly metadata?: Record<string, unknown> | null;
}

interface AuditLogRow {
  readonly id: string;
  readonly operator_external_user_id: string;
  readonly operator_email: string;
  readonly action: PlatformOperatorAuditAction;
  readonly target_tenant_id: string | null;
  readonly target_user_id: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly created_at: Date;
}

function mapRowToEntry(row: AuditLogRow): PlatformOperatorAuditLogEntry {
  return {
    id: row.id,
    operatorExternalUserId: row.operator_external_user_id,
    operatorEmail: row.operator_email,
    action: row.action,
    targetTenantId: row.target_tenant_id,
    targetUserId: row.target_user_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

const AUDIT_LOG_COLUMNS =
  'id, operator_external_user_id, operator_email, action, target_tenant_id, target_user_id, metadata, created_at';

/**
 * Persistência de `platform_operator_audit_log`
 * (`db/migrations/0038_create_platform_operator_audit_log.sql`) — dado da
 * plataforma, **sem RLS**, mesmo padrão de `tenants`/`plans`. Rastro de toda
 * ação de escrita do painel do gestor do SaaS e de início/fim de sessão de
 * impersonation (pré-requisito de segurança, ver `admin.routes.ts`).
 */
export class PlatformOperatorAuditLogRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO platform_operator_audit_log
         (operator_external_user_id, operator_email, action, target_tenant_id, target_user_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.operatorExternalUserId,
        input.operatorEmail,
        input.action,
        input.targetTenantId ?? null,
        input.targetUserId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
  }

  /** Mais recentes primeiro. `tenantId` opcional filtra só ações que tiveram aquele tenant como alvo. */
  async findRecent(options: { readonly tenantId?: string; readonly limit: number }): Promise<
    readonly PlatformOperatorAuditLogEntry[]
  > {
    const result = options.tenantId
      ? await this.pool.query<AuditLogRow>(
          `SELECT ${AUDIT_LOG_COLUMNS} FROM platform_operator_audit_log
           WHERE target_tenant_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [options.tenantId, options.limit],
        )
      : await this.pool.query<AuditLogRow>(
          `SELECT ${AUDIT_LOG_COLUMNS} FROM platform_operator_audit_log
           ORDER BY created_at DESC
           LIMIT $1`,
          [options.limit],
        );

    return result.rows.map(mapRowToEntry);
  }
}
