import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { EnrichedDeployment } from './domain-context.types';

const UPSERT_SQL = `
  INSERT INTO enriched_deployments (
    id, tenant_id, team_id, semantic_environment, processed_at, applied_rule_version
  )
  VALUES (
    $1, $2, $3, $4, NOW(), $5
  )
  ON CONFLICT (id) DO UPDATE SET
    team_id = EXCLUDED.team_id,
    semantic_environment = EXCLUDED.semantic_environment,
    processed_at = NOW(),
    applied_rule_version = EXCLUDED.applied_rule_version;
`;

function toQueryParams(deployment: EnrichedDeployment): unknown[] {
  return [
    deployment.id,
    deployment.tenantId,
    deployment.teamId,
    deployment.semanticEnvironment,
    deployment.appliedRuleVersion,
  ];
}

/**
 * Persistência da Enriched Layer para Deploys
 * (tabela `enriched_deployments`, `db/migrations/0020_create_enriched_deployments.sql`).
 *
 * `id` é compartilhado com `canonical_deployments` (mesma PK) — reprocessar
 * um deploy já enriquecido atualiza a linha existente in-place, nunca duplica.
 *
 * Tenant-scoped: toda operação roda dentro de `withTenantContext` (RLS,
 * Seção 4.3 da spec).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 5.
 */
export class EnrichedDeploymentRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /**
   * Insere ou atualiza um lote de deploys enriquecidos em uma única
   * transação. Todos os itens devem pertencer ao mesmo tenant.
   *
   * @returns A quantidade de registros persistidos.
   * @throws {Error} Se o lote misturar `tenantId` diferentes.
   */
  async upsertMany(deployments: readonly EnrichedDeployment[]): Promise<number> {
    if (deployments.length === 0) {
      return 0;
    }

    const [{ tenantId }] = deployments;
    const hasMixedTenants = deployments.some((deployment) => deployment.tenantId !== tenantId);

    if (hasMixedTenants) {
      throw new Error(
        'EnrichedDeploymentRepository.upsertMany: o lote contém tenantId diferentes; cada chamada deve pertencer a um único tenant.',
      );
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      for (const deployment of deployments) {
        await client.query(UPSERT_SQL, toQueryParams(deployment));
      }

      return deployments.length;
    });
  }
}
