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
  readonly team_id: string | null;
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
    teamId: row.team_id,
    metadata: row.metadata,
    readAt: row.read_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

/**
 * Persistência de `alerts` (`db/migrations/0046_create_alerts.sql`,
 * `0048_add_onboarding_alerts.sql`) — alertas in-app, não confundir com
 * `src/notifications/` (e-mail outbound).
 *
 * `create`/`resolveOpenAlerts`/`evaluate*Alert` nunca lançam — são chamados
 * de dentro do caminho quente de sync/billing/scan e não podem derrubar uma
 * operação que já rodou de verdade (mesmo espírito do
 * `IntegrationRunHistoryRepository.record()`). `findAllByTenant`/`markRead`/
 * `markAllRead`/`hasOpenAlert` são de rota HTTP e podem lançar normalmente.
 *
 * Dedup/resolução de "alerta aberto" é sempre por `(tenant, type, subject)`,
 * onde `subject` é `integrationId` (alertas de sync/reconexão) ou `teamId`
 * (alertas de time) — os dois `null` identifica o alerta de onboarding,
 * que é de nível de tenant, sem um recurso específico.
 */
export class AlertRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(tenantId: string, input: CreateAlertInput): Promise<void> {
    try {
      await withTenantContext(this.pool, tenantId, (client) =>
        client.query(
          `INSERT INTO alerts (tenant_id, type, severity, title, message, integration_id, team_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            tenantId,
            input.type,
            input.severity,
            input.title,
            input.message,
            input.integrationId ?? null,
            input.teamId ?? null,
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
        `SELECT id, tenant_id, type, severity, title, message, integration_id, team_id, metadata, read_at, resolved_at, created_at
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

  async hasOpenAlert(
    tenantId: string,
    type: AlertType,
    integrationId: string | null,
    teamId: string | null = null,
  ): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT 1 FROM alerts
         WHERE tenant_id = $1 AND type = $2 AND integration_id IS NOT DISTINCT FROM $3
           AND team_id IS NOT DISTINCT FROM $4 AND resolved_at IS NULL
         LIMIT 1`,
        [tenantId, type, integrationId, teamId],
      );
      return result.rows.length > 0;
    });
  }

  /** Fecha (auto-resolve) qualquer alerta aberto deste tipo/assunto. Nunca lança. */
  async resolveOpenAlerts(
    tenantId: string,
    type: AlertType,
    integrationId: string | null,
    teamId: string | null = null,
  ): Promise<void> {
    try {
      await withTenantContext(this.pool, tenantId, (client) =>
        client.query(
          `UPDATE alerts SET resolved_at = NOW()
           WHERE tenant_id = $1 AND type = $2 AND integration_id IS NOT DISTINCT FROM $3
             AND team_id IS NOT DISTINCT FROM $4 AND resolved_at IS NULL`,
          [tenantId, type, integrationId, teamId],
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

  /**
   * Alerta de nível de tenant (sem `integrationId`/`teamId`): "workspace
   * ainda não configurado" — nenhum time criado e ninguém além do ADMIN que
   * criou a conta (`isBootstrap` em `users.routes.ts`) foi materializado.
   * Resolve sozinho assim que qualquer uma das duas condições deixar de
   * valer (criou um time OU convidou/materializou alguém). Nunca lança.
   */
  async evaluateOnboardingAlert(tenantId: string, teamCount: number, userCount: number): Promise<void> {
    try {
      const incomplete = teamCount === 0 && userCount <= 1;

      if (!incomplete) {
        await this.resolveOpenAlerts(tenantId, 'onboarding_incomplete', null);
        return;
      }
      if (await this.hasOpenAlert(tenantId, 'onboarding_incomplete', null)) return;

      await this.create(tenantId, {
        type: 'onboarding_incomplete',
        severity: 'info',
        title: 'Finalize a configuração do seu workspace',
        message:
          'Seu workspace ainda não tem nenhum time criado nem outras pessoas convidadas além de você. Crie um time e convide sua equipe para começar a ver métricas de DORA e Flow.',
        metadata: { teamCount, userCount },
      });
    } catch (error) {
      console.error(`[AlertRepository] Falha ao avaliar alerta de onboarding (tenant ${tenantId}): ${(error as Error).message}`);
    }
  }

  /**
   * Alerta por time: existe, mas não tem nenhuma linha em
   * `team_memberships` — métricas escopadas a esse time (`?teamId=` no
   * dashboard) ficam vazias não por falta de dado real, mas por falta de
   * gente cadastrada nele. Resolve sozinho quando o time ganha o primeiro
   * membro. Nunca lança.
   */
  async evaluateTeamContributorsAlert(
    tenantId: string,
    teamId: string,
    teamName: string,
    hasContributors: boolean,
  ): Promise<void> {
    try {
      if (hasContributors) {
        await this.resolveOpenAlerts(tenantId, 'team_without_contributors', null, teamId);
        return;
      }
      if (await this.hasOpenAlert(tenantId, 'team_without_contributors', null, teamId)) return;

      await this.create(tenantId, {
        type: 'team_without_contributors',
        severity: 'info',
        title: 'Time sem contribuidores',
        message: `O time "${teamName}" ainda não tem nenhum contribuidor cadastrado. Adicione membros a esse time para que as métricas dele comecem a ser calculadas.`,
        teamId,
        metadata: { teamId, teamName },
      });
    } catch (error) {
      console.error(
        `[AlertRepository] Falha ao avaliar alerta de contribuidores (time ${teamId}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Alerta de nível de tenant pra teto de recursos do plano
   * (`BillingService.getResourceLimit`) — `type` já distingue qual recurso
   * (usuários/times/integrações), por isso `integrationId`/`teamId` ficam
   * sempre `null`, mesma ideia de `evaluateOnboardingAlert`. Chamado tanto
   * no momento do bloqueio (`403` nas rotas de criação, cria) quanto no
   * scan periódico (resolve quando volta a caber sob o limite — e também
   * cria proativamente se um tenant já estiver acima do limite sem
   * ninguém ter tentado criar nada recentemente, ex: downgrade de plano).
   * Nunca lança.
   */
  async evaluateResourceLimitAlert(
    tenantId: string,
    type: 'users_limit_reached' | 'teams_limit_reached' | 'integrations_limit_reached',
    currentCount: number,
    limit: number | null,
  ): Promise<void> {
    try {
      const atLimit = limit !== null && currentCount >= limit;

      if (!atLimit) {
        await this.resolveOpenAlerts(tenantId, type, null);
        return;
      }
      if (await this.hasOpenAlert(tenantId, type, null)) return;

      const copy: Record<typeof type, { readonly title: string; readonly noun: string }> = {
        users_limit_reached: { title: 'Limite de usuários atingido', noun: 'usuário(s)' },
        teams_limit_reached: { title: 'Limite de times atingido', noun: 'time(s)' },
        integrations_limit_reached: { title: 'Limite de integrações atingido', noun: 'integração(ões)' },
      };
      const { title, noun } = copy[type];

      await this.create(tenantId, {
        type,
        severity: 'warning',
        title,
        message: `Seu plano permite até ${limit} ${noun} e esse limite já foi atingido. Faça upgrade do plano para continuar.`,
        metadata: { currentCount, limit },
      });
    } catch (error) {
      console.error(
        `[AlertRepository] Falha ao avaliar alerta de limite (tenant ${tenantId}, tipo ${type}): ${(error as Error).message}`,
      );
    }
  }
}
