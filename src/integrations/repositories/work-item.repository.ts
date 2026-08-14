import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../../database/pool';
import type { CanonicalWorkItem, IssueTrackerProvider } from '../core/canonical.types';

/** `team_resource_links.resource_type` correspondente a cada `IssueTrackerProvider`. */
const GROUP_RESOURCE_TYPE_BY_PROVIDER: Record<IssueTrackerProvider, string> = {
  jira: 'jira_project',
  linear: 'linear_team',
  azure_boards: 'azure_boards_project',
};

/** Um `CanonicalWorkItem` já persistido, com o `id` gerado pelo banco (necessário pra Enriched Layer). */
export interface PersistedWorkItem extends CanonicalWorkItem {
  readonly id: string;
}

interface WorkItemRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly provider: IssueTrackerProvider;
  readonly external_id: string;
  readonly raw_issue_type: string;
  readonly raw_status: string;
  readonly raw_labels: readonly string[] | null;
  readonly title: string;
  readonly assignee_external_id: string | null;
  readonly external_group_key: string | null;
  readonly external_group_name: string | null;
  readonly parent_external_id: string | null;
  readonly parent_external_name: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRowToPersistedWorkItem(row: WorkItemRow): PersistedWorkItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    externalId: row.external_id,
    rawIssueType: row.raw_issue_type,
    rawStatus: row.raw_status,
    rawLabels: row.raw_labels ?? [],
    title: row.title,
    assigneeExternalId: row.assignee_external_id,
    externalGroupKey: row.external_group_key,
    externalGroupName: row.external_group_name,
    parentExternalId: row.parent_external_id,
    parentExternalName: row.parent_external_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const UPSERT_SQL = `
  INSERT INTO canonical_work_items (
    tenant_id, provider, external_id, raw_issue_type, raw_status, raw_labels,
    title, assignee_external_id, created_at, updated_at, synced_at, provider_integration_id, external_group_key, external_group_name,
    parent_external_id, parent_external_name
  )
  VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, NOW(), $11, $12, $13,
    $14, $15
  )
  ON CONFLICT ON CONSTRAINT unique_tenant_integration_item DO UPDATE SET
    raw_issue_type = EXCLUDED.raw_issue_type,
    raw_status = EXCLUDED.raw_status,
    raw_labels = EXCLUDED.raw_labels,
    title = EXCLUDED.title,
    assignee_external_id = EXCLUDED.assignee_external_id,
    updated_at = EXCLUDED.updated_at,
    synced_at = NOW(),
    external_group_key = EXCLUDED.external_group_key,
    external_group_name = EXCLUDED.external_group_name,
    parent_external_id = EXCLUDED.parent_external_id,
    parent_external_name = EXCLUDED.parent_external_name;
`;

function toQueryParams(workItem: CanonicalWorkItem, providerIntegrationId: string): unknown[] {
  return [
    workItem.tenantId,
    workItem.provider,
    workItem.externalId,
    workItem.rawIssueType,
    workItem.rawStatus,
    workItem.rawLabels,
    workItem.title,
    workItem.assigneeExternalId ?? null,
    workItem.createdAt,
    workItem.updatedAt,
    providerIntegrationId,
    workItem.externalGroupKey ?? null,
    workItem.externalGroupName ?? null,
    workItem.parentExternalId ?? null,
    workItem.parentExternalName ?? null,
  ];
}

/**
 * Persistência da Camada Canônica para Work Items
 * (tabela `canonical_work_items`, ver `db/migrations/0011_create_canonical_work_items.sql`).
 *
 * Toda escrita usa UPSERT sobre a unique constraint
 * `(tenant_id, provider_integration_id, external_id)`, garantindo que reexecuções de um
 * mesmo lote de sync incremental sejam idempotentes e que dois tenants nunca
 * colidam entre si mesmo em providers self-hosted onde o `external_id`
 * isolado não é globalmente único.
 *
 * Toda escrita roda dentro de `withTenantContext` (RLS, Seção 4.3 da spec).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 5.
 */
export class WorkItemRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /** Insere ou atualiza um único Work Item canônico. */
  async upsert(workItem: CanonicalWorkItem, providerIntegrationId: string): Promise<void> {
    await withTenantContext(this.pool, workItem.tenantId, (client) =>
      client.query(UPSERT_SQL, toQueryParams(workItem, providerIntegrationId)),
    );
  }

  /**
   * Insere ou atualiza um lote de Work Items canônicos em uma única
   * transação. Se qualquer registro falhar, o lote inteiro é revertido.
   *
   * Todos os itens do lote devem pertencer ao mesmo tenant (é sempre o caso
   * na prática: um lote vem de um único `SyncContext`).
   *
   * @returns A quantidade de registros persistidos.
   * @throws {Error} Se o lote misturar `tenantId` diferentes.
   */
  async upsertMany(workItems: readonly CanonicalWorkItem[], providerIntegrationId: string): Promise<number> {
    if (workItems.length === 0) {
      return 0;
    }

    const [{ tenantId }] = workItems;
    const hasMixedTenants = workItems.some((workItem) => workItem.tenantId !== tenantId);

    if (hasMixedTenants) {
      throw new Error(
        'WorkItemRepository.upsertMany: o lote contém tenantId diferentes; cada chamada deve pertencer a um único tenant.',
      );
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      for (const workItem of workItems) {
        await client.query(UPSERT_SQL, toQueryParams(workItem, providerIntegrationId));
      }

      return workItems.length;
    });
  }

  /**
   * Valores distintos de `raw_issue_type` já sincronizados — alimenta a
   * tela de Regras Semânticas (multi-select em vez de texto livre).
   */
  async findDistinctIssueTypes(tenantId: string): Promise<readonly string[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ raw_issue_type: string }>(
        `SELECT DISTINCT raw_issue_type FROM canonical_work_items WHERE tenant_id = $1 ORDER BY raw_issue_type`,
        [tenantId],
      );
      return result.rows.map((row) => row.raw_issue_type);
    });
  }

  /**
   * Valores distintos de `raw_status` já sincronizados — mesma finalidade
   * de `findDistinctIssueTypes`, pra `workflowStates.rawStatusValues`.
   */
  async findDistinctStatuses(tenantId: string): Promise<readonly string[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ raw_status: string }>(
        `SELECT DISTINCT raw_status FROM canonical_work_items WHERE tenant_id = $1 ORDER BY raw_status`,
        [tenantId],
      );
      return result.rows.map((row) => row.raw_status);
    });
  }

  /**
   * Valores distintos de label já sincronizados (achatando o array
   * `raw_labels` de cada item) — mesma finalidade de `findDistinctIssueTypes`.
   */
  async findDistinctLabels(tenantId: string): Promise<readonly string[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ label: string }>(
        `SELECT DISTINCT unnest(raw_labels) AS label
         FROM canonical_work_items
         WHERE tenant_id = $1 AND raw_labels IS NOT NULL
         ORDER BY label`,
        [tenantId],
      );
      return result.rows.map((row) => row.label);
    });
  }

  /** Lista todos os Work Items canônicos de uma integração específica — usado pela Enriched Layer. */
  async findByIntegration(tenantId: string, providerIntegrationId: string): Promise<readonly PersistedWorkItem[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<WorkItemRow>(
        `SELECT id, tenant_id, provider, external_id, raw_issue_type, raw_status, raw_labels,
                title, assignee_external_id, external_group_key, external_group_name,
                parent_external_id, parent_external_name, created_at, updated_at
         FROM canonical_work_items
         WHERE tenant_id = $1 AND provider_integration_id = $2`,
        [tenantId, providerIntegrationId],
      );

      return result.rows.map(mapRowToPersistedWorkItem);
    });
  }

  /**
   * Valores distintos de `external_group_key` (projeto no Jira, time no
   * Linear) já sincronizados por esse `provider` que ainda **não** estão
   * vinculados a nenhum time da plataforma — candidatos a vínculo via
   * `team_resource_links`. Mesmo padrão de
   * `PullRequestRepository.findUnlinkedRepositories`.
   *
   * `DISTINCT ON (external_group_key)` (não `DISTINCT` cru) + `ORDER BY ...,
   * synced_at DESC`: pega o nome mais recente pra cada chave — cobre o caso
   * raro de renomeação de projeto/time sem devolver a mesma key duas vezes
   * com nomes diferentes.
   */
  async findUnlinkedExternalGroups(
    tenantId: string,
    provider: IssueTrackerProvider,
  ): Promise<readonly { readonly key: string; readonly name: string | null }[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ external_group_key: string; external_group_name: string | null }>(
        `SELECT DISTINCT ON (external_group_key) external_group_key, external_group_name
         FROM canonical_work_items cwi
         WHERE cwi.tenant_id = $1
           AND cwi.provider = $2
           AND cwi.external_group_key IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM team_resource_links trl
             WHERE trl.tenant_id = cwi.tenant_id
               AND trl.provider = cwi.provider
               AND trl.resource_type = $3
               AND trl.external_resource_id = cwi.external_group_key
           )
         ORDER BY external_group_key, synced_at DESC`,
        [tenantId, provider, GROUP_RESOURCE_TYPE_BY_PROVIDER[provider]],
      );

      return result.rows.map((row) => ({ key: row.external_group_key, name: row.external_group_name }));
    });
  }
}
