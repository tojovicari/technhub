import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { AlertEntry, AlertType, CreateAlertInput } from './alert.types';

/** Falhas seguidas de sync até o alerta "precisa reconexão" disparar. */
export const RECONNECT_FAILURE_THRESHOLD = 3;

interface AlertRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly type: AlertType;
  readonly severity: AlertEntry['severity'];
  readonly title: string;
  readonly message: string;
  readonly integration_id: string | null;
  readonly metadata: unknown;
  readonly read_at: Date | null;
  readonly resolved_at: Date | null;
  readonly created_at: Date;
}

function mapRowToEntry(row: AlertRow): AlertEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    message: row.message,
    integrationId: row.integration_id,
    metadata: row.metadata,
    readAt: row.read_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

/**
 * Persistência de `alerts` (`db/migrations/0046_create_alerts.sql`) —
 * alertas in-app, não confundir com `src/notifications/` (e-mail outbound).
 *
 * `create`/`resolveOpenAlerts`/`evaluateReconnectionAlert` nunca lançam —
 * são chamados de dentro do caminho quente de sync/billing e não podem
 * derrubar uma operação que já rodou de verdade (mesmo espírito do
 * `IntegrationRunHistoryRepository.record()`). `findAllByTenant`/`markRead`/
 * `markAllRead`/`hasOpenAlert` são de rota HTTP e podem lançar normalmente.
 */
export class AlertRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(tenantId: string, input: CreateAlertInput): Promise<void> {
    try {
      await withTenantContext(this.pool, tenantId, (client) =>
        client.query(
          `INSERT INTO alerts (tenant_id, type, severity, title, message, integration_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            tenantId,
            input.type,
            input.severity,
            input.title,
            input.message,
            input.integrationId ?? null,
            input.metadata !== undefined ? JSON.stringify(input.metadata) : null,
          ],
        ),
      );
    } catch (error) {
      console.error(
        `[AlertRepository] Falha ao gravar alerta (tenant ${tenantId}, tipo ${input.type}): ${(error as Error).message}`,
      );
    }
  }

  async findAllByTenant(
    tenantId: string,
    options?: { readonly unreadOnly?: boolean; readonly limit?: number },
  ): Promise<readonly AlertEntry[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<AlertRow>(
        `SELECT id, tenant_id, type, severity, title, message, integration_id, metadata, read_at, resolved_at, created_at
         FROM alerts
         WHERE tenant_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL)
         ORDER BY created_at DESC
         LIMIT $3`,
        [tenantId, options?.unreadOnly ?? false, options?.limit ?? 50],
      );
      return result.rows.map(mapRowToEntry);
    });
  }

  /** `true` se a linha existia neste tenant (idempotente — já lida ou não). */
  async markRead(tenantId: string, alertId: string): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE alerts SET read_at = COALESCE(read_at, NOW()) WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, alertId],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  /** Devolve quantos alertas foram marcados como lidos. */
  async markAllRead(tenantId: string): Promise<number> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(`UPDATE alerts SET read_at = NOW() WHERE tenant_id = $1 AND read_at IS NULL`, [
        tenantId,
      ]);
      return result.rowCount ?? 0;
    });
  }

  async hasOpenAlert(tenantId: string, type: AlertType, integrationId: string | null): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT 1 FROM alerts
         WHERE tenant_id = $1 AND type = $2 AND integration_id IS NOT DISTINCT FROM $3 AND resolved_at IS NULL
         LIMIT 1`,
        [tenantId, type, integrationId],
      );
      return result.rows.length > 0;
    });
  }

  /** Fecha (auto-resolve) qualquer alerta aberto deste tipo/integração. Nunca lança. */
  async resolveOpenAlerts(tenantId: string, type: AlertType, integrationId: string | null): Promise<void> {
    try {
      await withTenantContext(this.pool, tenantId, (client) =>
        client.query(
          `UPDATE alerts SET resolved_at = NOW()
           WHERE tenant_id = $1 AND type = $2 AND integration_id IS NOT DISTINCT FROM $3 AND resolved_at IS NULL`,
          [tenantId, type, integrationId],
        ),
      );
    } catch (error) {
      console.error(
        `[AlertRepository] Falha ao resolver alertas abertos (tenant ${tenantId}, tipo ${type}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Regra de negócio do alerta de reconexão — chamada pelos dois pontos que
   * já chamam `ProviderIntegrationRepository.markSyncOutcome`
   * (`integrations.routes.ts` e `internal.routes.ts`), logo em seguida, com
   * o `consecutiveFailures` que `markSyncOutcome` acabou de devolver.
   * `consecutiveFailures === 0` significa "essa chamada foi um sucesso"
   * (markSyncOutcome zera o contador nesse caso) — fecha qualquer alerta
   * aberto. Abaixo do limiar, não faz nada (ainda é "só uma falha
   * passageira"). Nunca lança.
   */
  async evaluateReconnectionAlert(
    tenantId: string,
    integrationId: string,
    provider: string,
    consecutiveFailures: number,
  ): Promise<void> {
    try {
      if (consecutiveFailures === 0) {
        await this.resolveOpenAlerts(tenantId, 'integration_reconnect_required', integrationId);
        return;
      }
      if (consecutiveFailures < RECONNECT_FAILURE_THRESHOLD) return;
      if (await this.hasOpenAlert(tenantId, 'integration_reconnect_required', integrationId)) return;

      await this.create(tenantId, {
        type: 'integration_reconnect_required',
        severity: 'critical',
        title: 'Integração precisa de reconexão',
        message: `A integração "${provider}" falhou ${consecutiveFailures} vezes seguidas ao sincronizar. Verifique as credenciais e reconecte.`,
        integrationId,
        metadata: { provider, consecutiveFailures },
      });
    } catch (error) {
      console.error(
        `[AlertRepository] Falha ao avaliar alerta de reconexão (integração ${integrationId}): ${(error as Error).message}`,
      );
    }
  }
}
