import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { EffectiveRules, MappingRules } from './domain-context.types';
import { SYSTEM_DEFAULT_RULE_VERSION, SYSTEM_DEFAULT_RULES } from './system-default-rules';

interface ConfigRow {
  readonly rules: MappingRules;
  readonly updated_at: Date;
}

/**
 * Persistência de `team_metric_configurations`
 * (`db/migrations/0013_create_team_metric_configurations.sql`) e resolução
 * de precedência do Domain Context Engine: Time > Organização
 * (`team_id IS NULL`) > Fallback do Sistema — Seção 3 da spec.
 *
 * Tenant-scoped: toda operação roda dentro de `withTenantContext` (RLS,
 * Seção 4.3 da spec).
 */
export class MappingRulesRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /** Cria ou substitui a configuração de um time específico. */
  async upsertTeamRules(tenantId: string, teamId: string, rules: MappingRules): Promise<void> {
    await withTenantContext(this.pool, tenantId, (client) =>
      client.query(
        `INSERT INTO team_metric_configurations (tenant_id, team_id, rules)
         VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT unique_tenant_team_config DO UPDATE SET
           rules = EXCLUDED.rules,
           updated_at = NOW()`,
        [tenantId, teamId, JSON.stringify(rules)],
      ),
    );
  }

  /**
   * Cria ou substitui a configuração de organização (fallback pro tenant
   * inteiro, sem time específico — `team_id IS NULL`).
   *
   * A unicidade aqui é um índice parcial (`unique_tenant_org_config`), não
   * uma constraint nomeada — `ON CONFLICT (tenant_id) WHERE team_id IS NULL`
   * é a forma que o Postgres exige pra inferir conflito contra um índice
   * parcial (`ON CONFLICT ON CONSTRAINT` só aceita constraints de verdade).
   */
  async upsertOrgRules(tenantId: string, rules: MappingRules): Promise<void> {
    await withTenantContext(this.pool, tenantId, (client) =>
      client.query(
        `INSERT INTO team_metric_configurations (tenant_id, team_id, rules)
         VALUES ($1, NULL, $2)
         ON CONFLICT (tenant_id) WHERE team_id IS NULL DO UPDATE SET
           rules = EXCLUDED.rules,
           updated_at = NOW()`,
        [tenantId, JSON.stringify(rules)],
      ),
    );
  }

  /**
   * Resolve as regras efetivas pra um time: configuração do time, senão da
   * organização, senão o Fallback do Sistema (hardcoded, não vem do banco).
   *
   * `teamId` nulo pula direto pra organização/fallback — caso do Waroom,
   * que não segue o modelo "1 integração = 1 time" (ver `enrichment.service.ts`).
   */
  async getEffectiveRules(tenantId: string, teamId: string | null): Promise<EffectiveRules> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      if (teamId !== null) {
        const teamResult = await client.query<ConfigRow>(
          `SELECT rules, updated_at FROM team_metric_configurations WHERE tenant_id = $1 AND team_id = $2`,
          [tenantId, teamId],
        );
        if (teamResult.rows.length > 0) {
          return { rules: teamResult.rows[0].rules, appliedRuleVersion: teamResult.rows[0].updated_at };
        }
      }

      const orgResult = await client.query<ConfigRow>(
        `SELECT rules, updated_at FROM team_metric_configurations WHERE tenant_id = $1 AND team_id IS NULL`,
        [tenantId],
      );
      if (orgResult.rows.length > 0) {
        return { rules: orgResult.rows[0].rules, appliedRuleVersion: orgResult.rows[0].updated_at };
      }

      return { rules: SYSTEM_DEFAULT_RULES, appliedRuleVersion: SYSTEM_DEFAULT_RULE_VERSION };
    });
  }

  /**
   * Leitura crua da configuração de organização, sem cair pro fallback do
   * sistema — usada pela tela de edição, que precisa saber exatamente o que
   * está gravado naquele nível (`null` se nada foi configurado ainda).
   */
  async getOrgRules(tenantId: string): Promise<EffectiveRules | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<ConfigRow>(
        `SELECT rules, updated_at FROM team_metric_configurations WHERE tenant_id = $1 AND team_id IS NULL`,
        [tenantId],
      );

      return result.rows.length === 0
        ? null
        : { rules: result.rows[0].rules, appliedRuleVersion: result.rows[0].updated_at };
    });
  }

  /**
   * Leitura crua da configuração de um time específico, sem mesclar com
   * organização/fallback — mesmo motivo de `getOrgRules`.
   */
  async getTeamRules(tenantId: string, teamId: string): Promise<EffectiveRules | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<ConfigRow>(
        `SELECT rules, updated_at FROM team_metric_configurations WHERE tenant_id = $1 AND team_id = $2`,
        [tenantId, teamId],
      );

      return result.rows.length === 0
        ? null
        : { rules: result.rows[0].rules, appliedRuleVersion: result.rows[0].updated_at };
    });
  }
}
