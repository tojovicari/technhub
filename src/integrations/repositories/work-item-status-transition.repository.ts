import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../../database/pool';
import type { CanonicalWorkItemStatusTransition, IssueTrackerProvider } from '../core/canonical.types';

interface StatusTransitionRow {
  readonly work_item_external_id: string;
  readonly external_change_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly transitioned_at: Date;
}

function mapRowToTransition(
  tenantId: string,
  provider: IssueTrackerProvider,
  row: StatusTransitionRow,
): CanonicalWorkItemStatusTransition {
  return {
    tenantId,
    provider,
    workItemExternalId: row.work_item_external_id,
    externalChangeId: row.external_change_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    transitionedAt: row.transitioned_at,
  };
}

/**
 * Persistência da Camada Canônica para transições de status de work items
 * (tabela `canonical_work_item_status_transitions`, ver
 * `db/migrations/0033_create_canonical_work_item_status_transitions.sql`).
 *
 * Correlaciona com `canonical_work_items` por chave natural
 * (`provider_integration_id` + `work_item_external_id`), não por FK — mesmo
 * padrão de `team_resource_links`.
 *
 * Transições nunca mudam depois de registradas (é histórico), então
 * `upsertMany` é `ON CONFLICT DO NOTHING`, não `DO UPDATE`.
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 5.
 */
export class WorkItemStatusTransitionRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /**
   * Insere um lote de transições, ignorando as já conhecidas
   * (`external_change_id` repetido). Todos os itens do lote devem
   * pertencer ao mesmo tenant e à mesma integração.
   *
   * @returns A quantidade de registros novos inseridos.
   * @throws {Error} Se o lote misturar `tenantId` diferentes.
   */
  async upsertMany(
    transitions: readonly CanonicalWorkItemStatusTransition[],
    providerIntegrationId: string,
  ): Promise<number> {
    if (transitions.length === 0) {
      return 0;
    }

    const [{ tenantId }] = transitions;
    const hasMixedTenants = transitions.some((transition) => transition.tenantId !== tenantId);

    if (hasMixedTenants) {
      throw new Error(
        'WorkItemStatusTransitionRepository.upsertMany: o lote contém tenantId diferentes; cada chamada deve pertencer a um único tenant.',
      );
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      let inserted = 0;

      for (const transition of transitions) {
        const result = await client.query(
          `INSERT INTO canonical_work_item_status_transitions (
             tenant_id, provider_integration_id, work_item_external_id, external_change_id,
             from_status, to_status, transitioned_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (tenant_id, provider_integration_id, external_change_id) DO NOTHING`,
          [
            transition.tenantId,
            providerIntegrationId,
            transition.workItemExternalId,
            transition.externalChangeId,
            transition.fromStatus,
            transition.toStatus,
            transition.transitionedAt,
          ],
        );

        inserted += result.rowCount ?? 0;
      }

      return inserted;
    });
  }

  /**
   * Todas as transições de todos os work items de uma integração — usado
   * pela Enriched Layer. `provider` vem do chamador (já resolvido via
   * `IntegrationSummary`) em vez de um JOIN em `provider_integrations`.
   */
  async findByIntegration(
    tenantId: string,
    providerIntegrationId: string,
    provider: IssueTrackerProvider,
  ): Promise<readonly CanonicalWorkItemStatusTransition[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<StatusTransitionRow>(
        `SELECT work_item_external_id, external_change_id, from_status, to_status, transitioned_at
         FROM canonical_work_item_status_transitions
         WHERE tenant_id = $1 AND provider_integration_id = $2
         ORDER BY transitioned_at ASC`,
        [tenantId, providerIntegrationId],
      );

      return result.rows.map((row) => mapRowToTransition(tenantId, provider, row));
    });
  }
}
