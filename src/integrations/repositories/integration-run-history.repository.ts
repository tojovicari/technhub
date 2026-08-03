import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../../database/pool';

export type IntegrationRunType = 'sync' | 'enrichment';
export type IntegrationRunTrigger = 'manual' | 'cron';

export interface RecordIntegrationRunInput {
  readonly integrationId: string;
  readonly runType: IntegrationRunType;
  readonly triggeredBy: IntegrationRunTrigger;
  readonly success: boolean;
  readonly summary?: unknown;
  readonly errorMessage?: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date;
}

export interface IntegrationRunHistoryEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly integrationId: string;
  readonly runType: IntegrationRunType;
  readonly triggeredBy: IntegrationRunTrigger;
  readonly success: boolean;
  readonly summary: unknown;
  readonly errorMessage: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly createdAt: Date;
}

interface IntegrationRunHistoryRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly integration_id: string;
  readonly run_type: IntegrationRunType;
  readonly triggered_by: IntegrationRunTrigger;
  readonly success: boolean;
  readonly summary: unknown;
  readonly error_message: string | null;
  readonly started_at: Date;
  readonly finished_at: Date;
  readonly created_at: Date;
}

function mapRowToEntry(row: IntegrationRunHistoryRow): IntegrationRunHistoryEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    integrationId: row.integration_id,
    runType: row.run_type,
    triggeredBy: row.triggered_by,
    success: row.success,
    summary: row.summary,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

/**
 * Persistência de `integration_run_history`
 * (`db/migrations/0039_create_integration_run_history.sql`) — uma linha por
 * execução de sync (`SyncOrchestrator`) ou enrichment (`EnrichmentService`),
 * sucesso ou falha. Toda operação roda dentro de `withTenantContext` (RLS).
 *
 * `record` nunca lança — falha ao gravar histórico não pode derrubar a sync/
 * enrichment que já rodou de verdade (mesmo espírito de "nunca lança" do
 * `SyncOrchestrator`).
 */
export class IntegrationRunHistoryRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async record(tenantId: string, input: RecordIntegrationRunInput): Promise<void> {
    try {
      await withTenantContext(this.pool, tenantId, (client) =>
        client.query(
          `INSERT INTO integration_run_history
             (tenant_id, integration_id, run_type, triggered_by, success, summary, error_message, started_at, finished_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            tenantId,
            input.integrationId,
            input.runType,
            input.triggeredBy,
            input.success,
            input.summary !== undefined ? JSON.stringify(input.summary) : null,
            input.errorMessage ?? null,
            input.startedAt,
            input.finishedAt,
          ],
        ),
      );
    } catch (error) {
      console.error(
        `[IntegrationRunHistoryRepository] Falha ao gravar histórico de execução (integração ${input.integrationId}): ${(error as Error).message}`,
      );
    }
  }

  /** Mais recente primeiro — usado tanto pela tela de integrações do tenant quanto pelo drilldown do painel do gestor do SaaS. */
  async findByIntegration(
    tenantId: string,
    integrationId: string,
    limit = 20,
  ): Promise<readonly IntegrationRunHistoryEntry[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<IntegrationRunHistoryRow>(
        `SELECT id, tenant_id, integration_id, run_type, triggered_by, success, summary, error_message, started_at, finished_at, created_at
         FROM integration_run_history
         WHERE tenant_id = $1 AND integration_id = $2
         ORDER BY started_at DESC
         LIMIT $3`,
        [tenantId, integrationId, limit],
      );

      return result.rows.map(mapRowToEntry);
    });
  }
}
