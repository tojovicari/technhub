import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../../database/pool';
import type { CanonicalDeployment } from '../core/canonical.types';
import type { ExternalResourceType } from '../../identity/team-resource-link.repository';

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
  readonly external_group_key: string | null;
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
    externalGroupKey: row.external_group_key,
  };
}

const UPSERT_SQL = `
  INSERT INTO canonical_deployments (
    tenant_id, provider, external_id, environment, status,
    service_name, commit_sha, triggered_by_external_id, started_at, finished_at,
    external_group_key, synced_at, provider_integration_id
  )
  VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9, $10,
    $11, NOW(), $12
  )
  ON CONFLICT ON CONSTRAINT unique_tenant_integration_deployment DO UPDATE SET
    environment = EXCLUDED.environment,
    status = EXCLUDED.status,
    service_name = EXCLUDED.service_name,
    commit_sha = EXCLUDED.commit_sha,
    triggered_by_external_id = EXCLUDED.triggered_by_external_id,
    finished_at = EXCLUDED.finished_at,
    external_group_key = EXCLUDED.external_group_key,
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
    deployment.externalGroupKey ?? null,
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
                commit_sha, triggered_by_external_id, started_at, finished_at, external_group_key
         FROM canonical_deployments
         WHERE tenant_id = $1 AND provider_integration_id = $2`,
        [tenantId, providerIntegrationId],
      );

      return result.rows.map(mapRowToPersistedDeployment);
    });
  }

  /**
   * Lista todos os deploys canônicos de um provider inteiro (não só uma
   * integração) — usado pela Enriched Layer quando a resolução de time é
   * por registro (`team_resource_links`), não por integração inteira: se o
   * tenant tiver mais de uma integração ArgoCD, processar tudo de uma vez é
   * seguro e idempotente. Mesmo racional de `IncidentRepository.findByProvider`.
   */
  async findByProvider(tenantId: string, provider: string): Promise<readonly PersistedDeployment[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<DeploymentRow>(
        `SELECT id, tenant_id, provider, external_id, environment, status, service_name,
                commit_sha, triggered_by_external_id, started_at, finished_at, external_group_key
         FROM canonical_deployments
         WHERE tenant_id = $1 AND provider = $2`,
        [tenantId, provider],
      );

      return result.rows.map(mapRowToPersistedDeployment);
    });
  }

  /**
   * Times com mais de um `provider` distinto gerando deploy de produção
   * (`enriched_deployments.semantic_environment = 'PRODUCTION'`) — sinal de
   * possível contagem duplicada em Deployment Frequency (ex: `github_actions`
   * + `vercel` podem representar o mesmo deploy). Usado pelo scan periódico
   * (`POST /internal/alerts/scan-stale`) pra avaliar o alerta
   * `deployment_frequency_source_ambiguous`; a mesma checagem roda de novo,
   * já escopada ao período pedido, dentro de `DashboardService.queryDeploymentFrequency`.
   */
  async findTeamsWithMultipleProductionProviders(
    tenantId: string,
  ): Promise<readonly { readonly teamId: string; readonly providers: readonly string[] }[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ team_id: string; providers: string[] }>(
        `SELECT ed.team_id, array_agg(DISTINCT cd.provider) AS providers
         FROM canonical_deployments cd
         JOIN enriched_deployments ed ON ed.id = cd.id
         WHERE cd.tenant_id = $1 AND ed.semantic_environment = 'PRODUCTION' AND ed.team_id IS NOT NULL
         GROUP BY ed.team_id
         HAVING count(DISTINCT cd.provider) > 1`,
        [tenantId],
      );

      return result.rows.map((row) => ({ teamId: row.team_id, providers: row.providers }));
    });
  }

  /**
   * "Grupos de origem" (`external_group_key` — projeto do ArgoCD,
   * repositório do GitHub Actions) já vistos em deploys sincronizados que
   * ainda não estão vinculados a nenhum time da plataforma — alimenta
   * `GET /team-resource-links/candidates`. Mesmo padrão de
   * `WorkItemRepository.findUnlinkedExternalGroups`.
   *
   * `resourceType` é parâmetro (não fixo) porque o `trl.provider` do
   * vínculo nem sempre é igual ao `cd.provider` do deploy: GitHub Actions
   * reaproveita o vínculo `(provider: 'github', resourceType: 'github_repository')`
   * já usado pelos PRs, não um `(github_actions, ...)` próprio.
   */
  async findUnlinkedExternalGroups(
    tenantId: string,
    provider: string,
    resourceType: ExternalResourceType,
  ): Promise<readonly string[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ external_group_key: string }>(
        `SELECT DISTINCT external_group_key
         FROM canonical_deployments cd
         WHERE cd.tenant_id = $1
           AND cd.provider = $2
           AND cd.external_group_key IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM team_resource_links trl
             WHERE trl.tenant_id = cd.tenant_id
               AND trl.resource_type = $3
               AND trl.external_resource_id = cd.external_group_key
           )
         ORDER BY external_group_key`,
        [tenantId, provider, resourceType],
      );

      return result.rows.map((row) => row.external_group_key);
    });
  }

  /**
   * Apaga em lotes de até `batchSize` — `enriched_deployments`
   * correspondente some junto via `ON DELETE CASCADE`
   * (`0020_create_enriched_deployments.sql`). Chamado em loop pelo
   * `RetentionPurgeService` até devolver `0`. `started_at` é a data
   * "quando isso aconteceu" desta tabela.
   */
  async purgeOlderThan(tenantId: string, cutoff: Date, batchSize: number): Promise<number> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM canonical_deployments
         WHERE id IN (
           SELECT id FROM canonical_deployments WHERE tenant_id = $1 AND started_at < $2 LIMIT $3
         )`,
        [tenantId, cutoff, batchSize],
      );
      return result.rowCount ?? 0;
    });
  }

  /** Existe pelo menos 1 registro mais velho que `cutoff`? Usado só pro alerta de aproximação. */
  async existsOlderThan(tenantId: string, cutoff: Date): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT 1 FROM canonical_deployments WHERE tenant_id = $1 AND started_at < $2 LIMIT 1`,
        [tenantId, cutoff],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }
}
