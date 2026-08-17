import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { EffectiveTriggerConfig, MetricTriggerConfig } from './metric-trigger-config.types';
import { SYSTEM_DEFAULT_TRIGGER_CONFIG, SYSTEM_DEFAULT_TRIGGER_CONFIG_VERSION } from './system-default-triggers';
import { TeamMetricConfigHistoryRepository } from './team-metric-config-history.repository';

interface ConfigRow {
  readonly metric_triggers: MetricTriggerConfig;
  readonly updated_at: Date;
}

/**
 * Persistência dos gatilhos de DORA (`team_metric_configurations.metric_triggers`)
 * e resolução de precedência: Time > Organização (`team_id IS NULL`) >
 * Fallback do Sistema — mesmo modelo de `MappingRulesRepository`, repositório
 * irmão (não generalizado numa classe comum: JSONB + tipos de retorno
 * diferentes tornariam isso mais confuso, não menos, ver plano/decisão 1).
 *
 * Toda escrita grava uma entrada em `team_metric_configuration_history` na
 * MESMA transação (`withTenantContext` já embrulha em `BEGIN`/`COMMIT`),
 * via `TeamMetricConfigHistoryRepository` — nunca um upsert sem auditoria.
 */
export class MetricTriggerConfigRepository {
  constructor(
    private readonly pool: Pool = getPool(),
    private readonly historyRepository: TeamMetricConfigHistoryRepository = new TeamMetricConfigHistoryRepository(),
  ) {}

  /** Cria ou substitui a configuração de gatilho de um time específico. */
  async upsertTeamTriggers(
    tenantId: string,
    teamId: string,
    config: MetricTriggerConfig,
    changedByUserId: string,
  ): Promise<void> {
    await withTenantContext(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO team_metric_configurations (tenant_id, team_id, metric_triggers)
         VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT unique_tenant_team_config DO UPDATE SET
           metric_triggers = EXCLUDED.metric_triggers,
           updated_at = NOW()`,
        [tenantId, teamId, JSON.stringify(config)],
      );

      await this.historyRepository.record(client, {
        tenantId,
        teamId,
        configType: 'metric_triggers',
        snapshot: config,
        changedByUserId,
      });
    });
  }

  /**
   * Cria ou substitui a configuração de organização — mesma ressalva de
   * `MappingRulesRepository.upsertOrgRules` sobre `ON CONFLICT (tenant_id)
   * WHERE team_id IS NULL` (índice parcial, não constraint nomeada).
   */
  async upsertOrgTriggers(tenantId: string, config: MetricTriggerConfig, changedByUserId: string): Promise<void> {
    await withTenantContext(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO team_metric_configurations (tenant_id, team_id, metric_triggers)
         VALUES ($1, NULL, $2)
         ON CONFLICT (tenant_id) WHERE team_id IS NULL DO UPDATE SET
           metric_triggers = EXCLUDED.metric_triggers,
           updated_at = NOW()`,
        [tenantId, JSON.stringify(config)],
      );

      await this.historyRepository.record(client, {
        tenantId,
        teamId: null,
        configType: 'metric_triggers',
        snapshot: config,
        changedByUserId,
      });
    });
  }

  /**
   * Remove o gatilho de organização — `metric_triggers` volta a `NULL`,
   * nunca `DELETE FROM team_metric_configurations` (mesma ressalva de
   * `MappingRulesRepository.deleteOrgRules`: a linha pode ainda guardar
   * `rules`). `false` se não havia nada configurado neste nível.
   */
  async deleteOrgTriggers(tenantId: string, changedByUserId: string): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE team_metric_configurations SET metric_triggers = NULL, updated_at = NOW()
         WHERE tenant_id = $1 AND team_id IS NULL AND metric_triggers IS NOT NULL`,
        [tenantId],
      );
      const deleted = (result.rowCount ?? 0) > 0;

      if (deleted) {
        await this.historyRepository.record(client, {
          tenantId,
          teamId: null,
          configType: 'metric_triggers',
          snapshot: null,
          changedByUserId,
        });
      }

      return deleted;
    });
  }

  /** Remove o gatilho de um time específico — mesma forma de `deleteOrgTriggers`, ver lá. */
  async deleteTeamTriggers(tenantId: string, teamId: string, changedByUserId: string): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE team_metric_configurations SET metric_triggers = NULL, updated_at = NOW()
         WHERE tenant_id = $1 AND team_id = $2 AND metric_triggers IS NOT NULL`,
        [tenantId, teamId],
      );
      const deleted = (result.rowCount ?? 0) > 0;

      if (deleted) {
        await this.historyRepository.record(client, {
          tenantId,
          teamId,
          configType: 'metric_triggers',
          snapshot: null,
          changedByUserId,
        });
      }

      return deleted;
    });
  }

  /**
   * Resolve a config efetiva pra um time: config do time (se
   * `metric_triggers IS NOT NULL` ali), senão da organização, senão o
   * Fallback do Sistema. `teamId` nulo pula direto pra organização/fallback
   * — mesmo comportamento de `getEffectiveRules`.
   *
   * Diferente de `getEffectiveRules`: expõe `source` (de qual nível
   * resolveu) — necessário pro eco `appliedTriggerConfig` nas respostas de
   * DORA (ver plano, Decisão 3a).
   */
  async getEffectiveTriggerConfig(tenantId: string, teamId: string | null): Promise<EffectiveTriggerConfig> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      if (teamId !== null) {
        const teamResult = await client.query<ConfigRow>(
          `SELECT metric_triggers, updated_at FROM team_metric_configurations
           WHERE tenant_id = $1 AND team_id = $2 AND metric_triggers IS NOT NULL`,
          [tenantId, teamId],
        );
        if (teamResult.rows.length > 0) {
          return { config: teamResult.rows[0].metric_triggers, source: 'team', updatedAt: teamResult.rows[0].updated_at };
        }
      }

      const orgResult = await client.query<ConfigRow>(
        `SELECT metric_triggers, updated_at FROM team_metric_configurations
         WHERE tenant_id = $1 AND team_id IS NULL AND metric_triggers IS NOT NULL`,
        [tenantId],
      );
      if (orgResult.rows.length > 0) {
        return { config: orgResult.rows[0].metric_triggers, source: 'org', updatedAt: orgResult.rows[0].updated_at };
      }

      return {
        config: SYSTEM_DEFAULT_TRIGGER_CONFIG,
        source: 'system_default',
        updatedAt: SYSTEM_DEFAULT_TRIGGER_CONFIG_VERSION,
      };
    });
  }

  /** Leitura crua da config de organização, sem cair pro fallback — mesmo uso de `getOrgRules` (tela de edição). */
  async getOrgTriggers(tenantId: string): Promise<{ readonly config: MetricTriggerConfig; readonly updatedAt: Date } | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<ConfigRow>(
        `SELECT metric_triggers, updated_at FROM team_metric_configurations
         WHERE tenant_id = $1 AND team_id IS NULL AND metric_triggers IS NOT NULL`,
        [tenantId],
      );

      return result.rows.length === 0 ? null : { config: result.rows[0].metric_triggers, updatedAt: result.rows[0].updated_at };
    });
  }

  /** Leitura crua da config de um time específico, sem mesclar com organização/fallback — mesmo uso de `getTeamRules`. */
  async getTeamTriggers(
    tenantId: string,
    teamId: string,
  ): Promise<{ readonly config: MetricTriggerConfig; readonly updatedAt: Date } | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<ConfigRow>(
        `SELECT metric_triggers, updated_at FROM team_metric_configurations
         WHERE tenant_id = $1 AND team_id = $2 AND metric_triggers IS NOT NULL`,
        [tenantId, teamId],
      );

      return result.rows.length === 0 ? null : { config: result.rows[0].metric_triggers, updatedAt: result.rows[0].updated_at };
    });
  }
}
