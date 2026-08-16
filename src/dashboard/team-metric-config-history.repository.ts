import type { Pool, PoolClient } from 'pg';
import { getPool, withTenantContext } from '../database/pool';

export type MetricConfigType = 'mapping_rules' | 'metric_triggers';

export interface MetricConfigHistoryEntry {
  readonly id: string;
  readonly teamId: string | null;
  readonly configType: MetricConfigType;
  readonly snapshot: unknown;
  readonly changedByUserId: string;
  readonly changedByEmail: string;
  readonly changedAt: Date;
}

/**
 * Auditoria de "quem mudou a configuração de time/organização, e quando"
 * (`team_metric_configuration_history`, migration 0044) — cobre as duas
 * colunas de `team_metric_configurations` (`rules` e `metric_triggers`),
 * discriminadas por `configType`. Snapshot completo depois da mudança, não
 * diff — mesmo espírito de `IntegrationRunHistoryRepository`.
 *
 * Helper compartilhado por `MappingRulesRepository` e
 * `MetricTriggerConfigRepository` — nenhum dos dois grava histórico
 * sozinho, os dois chamam `record` de dentro da própria transação de
 * upsert (ver plano: escrita precisa ser atômica com o upsert, não um
 * wrapper solto na camada de rotas).
 */
export class TeamMetricConfigHistoryRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /**
   * Grava uma entrada — `client` precisa ser o mesmo já aberto pelo
   * `withTenantContext` do upsert que está chamando isto (nunca abre
   * transação própria), pra herdar tenant_id da GUC de sessão já setada e
   * ficar atômico com a mudança que está sendo auditada.
   */
  async record(
    client: PoolClient,
    input: {
      readonly tenantId: string;
      readonly teamId: string | null;
      readonly configType: MetricConfigType;
      readonly snapshot: unknown;
      readonly changedByUserId: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO team_metric_configuration_history (tenant_id, team_id, config_type, snapshot, changed_by_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.tenantId, input.teamId, input.configType, JSON.stringify(input.snapshot), input.changedByUserId],
    );
  }

  /**
   * Histórico recente pra um escopo (organização, `teamId: null`, ou um
   * time específico) — não mescla os dois, mesma convenção de
   * `getOrgRules`/`getTeamRules` (leitura crua por escopo, sem herdar
   * precedência). `changedByEmail` via JOIN em `users` na leitura, não
   * denormalizado — diferente de `platform_operator_audit_log` (onde o
   * operador não é uma linha de `users`), aqui sempre é.
   */
  async findRecent(
    tenantId: string,
    teamId: string | null,
    options: { readonly configType?: MetricConfigType; readonly limit: number },
  ): Promise<readonly MetricConfigHistoryEntry[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{
        id: string;
        team_id: string | null;
        config_type: MetricConfigType;
        snapshot: unknown;
        changed_by_user_id: string;
        changed_by_email: string;
        changed_at: Date;
      }>(
        `SELECT h.id, h.team_id, h.config_type, h.snapshot, h.changed_by_user_id,
                u.primary_email AS changed_by_email, h.changed_at
         FROM team_metric_configuration_history h
         JOIN users u ON u.id = h.changed_by_user_id
         WHERE h.tenant_id = $1
           AND h.team_id IS NOT DISTINCT FROM $2
           AND ($3::varchar IS NULL OR h.config_type = $3)
         ORDER BY h.changed_at DESC
         LIMIT $4`,
        [tenantId, teamId, options.configType ?? null, options.limit],
      );

      return result.rows.map((row) => ({
        id: row.id,
        teamId: row.team_id,
        configType: row.config_type,
        snapshot: row.snapshot,
        changedByUserId: row.changed_by_user_id,
        changedByEmail: row.changed_by_email,
        changedAt: row.changed_at,
      }));
    });
  }

  /**
   * Mudanças dentro de uma janela de tempo, pro escopo relevante a um time
   * (a própria config do time **e** a de organização, já que organização
   * também vale pra ele via precedência quando ele não tem override) ou só
   * de organização quando `teamId` é `null` (visão tenant-wide, mistura
   * vários times — mudança de um time só não é anotação útil nesse nível).
   * Usado por `DashboardService.getDoraHistory` pra marcar "algo mudou aqui"
   * na série histórica do DORA, não pra reconstruir "o que valia em cada
   * ponto".
   *
   * `teamId: null` reduz sozinho pra "só organização": `h.team_id = $2`
   * nunca bate quando `$2` é `NULL` (comparação SQL), sem precisar de branch
   * condicional — mesmo truque já usado em `evaluateResourceLimitAlert` etc.
   */
  async findChangesInRange(
    tenantId: string,
    teamId: string | null,
    since: Date,
  ): Promise<readonly MetricConfigHistoryEntry[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{
        id: string;
        team_id: string | null;
        config_type: MetricConfigType;
        snapshot: unknown;
        changed_by_user_id: string;
        changed_by_email: string;
        changed_at: Date;
      }>(
        `SELECT h.id, h.team_id, h.config_type, h.snapshot, h.changed_by_user_id,
                u.primary_email AS changed_by_email, h.changed_at
         FROM team_metric_configuration_history h
         JOIN users u ON u.id = h.changed_by_user_id
         WHERE h.tenant_id = $1
           AND (h.team_id IS NULL OR h.team_id = $2)
           AND h.changed_at >= $3
         ORDER BY h.changed_at ASC`,
        [tenantId, teamId, since],
      );

      return result.rows.map((row) => ({
        id: row.id,
        teamId: row.team_id,
        configType: row.config_type,
        snapshot: row.snapshot,
        changedByUserId: row.changed_by_user_id,
        changedByEmail: row.changed_by_email,
        changedAt: row.changed_at,
      }));
    });
  }
}
