import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../../database/pool';
import type { CanonicalDeployment } from '../core/canonical.types';

/** Um `CanonicalDeployment` já persistido, com o `id` gerado pelo banco (necessário pra Enriched Layer). */
export interface PersistedDeployment extends CanonicalDeployment {
  readonly id: string;
}

interface DeploymentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly provider: CanonicalDeployment['provider'];
  readonly external_id: string;
  readonly environment: string;
  readonly status: CanonicalDeployment['status'];
  readonly service_name: string | null;
  readonly commit_sha: string | null;
  readonly triggered_by_external_id: string | null;
  readonly started_at: Date;
  readonly finished_at: Date | null;
}

function mapRowToPersistedDeployment(row: DeploymentRow): PersistedDeployment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    externalId: row.external_id,
    environment: row.environment,
    status: row.status,
    serviceName: row.service_name,
    commitSha: row.commit_sha,
    triggeredByExternalId: row.triggered_by_external_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

const UPSERT_SQL = `
  INSERT INTO canonical_deployments (
    tenant_id, provider, external_id, environment, status,
    service_name, commit_sha, triggered_by_external_id, started_at, finished_at, synced_at, provider_integration_id
  )
  VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9, $10, NOW(), $11
  )
  ON CONFLICT ON CONSTRAINT unique_tenant_integration_deployment DO UPDATE SET
    environment = EXCLUDED.environment,
    status = EXCLUDED.status,
    service_name = EXCLUDED.service_name,
    commit_sha = EXCLUDED.commit_sha,
    triggered_by_external_id = EXCLUDED.triggered_by_external_id,
    finished_at = EXCLUDED.finished_at,
    synced_at = NOW();
`;

function toQueryParams(deployment: CanonicalDeployment, providerIntegrationId: string): unknown[] {
  return [
    deployment.tenantId,
    deployment.provider,
    deployment.externalId,
    deployment.environment,
    deployment.status,
    deployment.serviceName ?? null,
    deployment.commitSha ?? null,
    deployment.triggeredByExternalId ?? null,
    deployment.startedAt,
    deployment.finishedAt ?? null,
    providerIntegrationId,
  ];
}

/**
 * Persistência da Camada Canônica para Deploys
 * (tabela `canonical_deployments`, ver `db/migrations/0019_create_canonical_deployments.sql`).
 *
 * Toda escrita usa UPSERT sobre a unique constraint
 * `(tenant_id, provider, external_id)`, garantindo que reexecuções de um
 * mesmo lote de sync incremental sejam idempotentes.
 *
 * Toda escrita roda dentro de `withTenantContext` (RLS, Seção 4.3 da spec).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 5.
 */
export class DeploymentRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /** Insere ou atualiza um único deploy canônico. */
  async upsert(deployment: CanonicalDeployment, providerIntegrationId: string): Promise<void> {
    await withTenantContext(this.pool, deployment.tenantId, (client) =>
      client.query(UPSERT_SQL, toQueryParams(deployment, providerIntegrationId)),
    );
  }

  /**
   * Insere ou atualiza um lote de deploys canônicos em uma única transação.
   * Todos os itens devem pertencer ao mesmo tenant.
   *
   * @returns A quantidade de registros persistidos.
   * @throws {Error} Se o lote misturar `tenantId` diferentes.
   */
  async upsertMany(deployments: readonly CanonicalDeployment[], providerIntegrationId: string): Promise<number> {
    if (deployments.length === 0) {
      return 0;
    }

    const [{ tenantId }] = deployments;
    const hasMixedTenants = deployments.some((deployment) => deployment.tenantId !== tenantId);

    if (hasMixedTenants) {
      throw new Error(
        'DeploymentRepository.upsertMany: o lote contém tenantId diferentes; cada chamada deve pertencer a um único tenant.',
      );
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      for (const deployment of deployments) {
        await client.query(UPSERT_SQL, toQueryParams(deployment, providerIntegrationId));
      }

      return deployments.length;
    });
  }

  /**
   * Valores distintos de `environment` já sincronizados — alimenta a tela
   * de Regras Semânticas (multi-select em vez de texto livre).
   */
  async findDistinctEnvironments(tenantId: string): Promise<readonly string[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ environment: string }>(
        `SELECT DISTINCT environment FROM canonical_deployments WHERE tenant_id = $1 ORDER BY environment`,
        [tenantId],
      );
      return result.rows.map((row) => row.environment);
    });
  }

  /** Lista todos os deploys canônicos de uma integração específica — usado pela Enriched Layer. */
  async findByIntegration(tenantId: string, providerIntegrationId: string): Promise<readonly PersistedDeployment[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<DeploymentRow>(
        `SELECT id, tenant_id, provider, external_id, environment, status, service_name,
                commit_sha, triggered_by_external_id, started_at, finished_at
         FROM canonical_deployments
         WHERE tenant_id = $1 AND provider_integration_id = $2`,
        [tenantId, providerIntegrationId],
      );

      return result.rows.map(mapRowToPersistedDeployment);
    });
  }
}
