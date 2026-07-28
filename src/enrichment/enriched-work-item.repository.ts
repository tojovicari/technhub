import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { EnrichedWorkItem } from './domain-context.types';

const UPSERT_SQL = `
  INSERT INTO enriched_work_items (
    id, tenant_id, team_id, semantic_category, semantic_state, is_active_work,
    started_working_at, completed_at, processed_at, applied_rule_version
  )
  VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, NOW(), $9
  )
  ON CONFLICT (id) DO UPDATE SET
    team_id = EXCLUDED.team_id,
    semantic_category = EXCLUDED.semantic_category,
    semantic_state = EXCLUDED.semantic_state,
    is_active_work = EXCLUDED.is_active_work,
    started_working_at = EXCLUDED.started_working_at,
    completed_at = EXCLUDED.completed_at,
    processed_at = NOW(),
    applied_rule_version = EXCLUDED.applied_rule_version;
`;

function toQueryParams(item: EnrichedWorkItem): unknown[] {
  return [
    item.id,
    item.tenantId,
    item.teamId,
    item.semanticCategory,
    item.semanticState,
    item.isActiveWork,
    item.startedWorkingAt ?? null,
    item.completedAt ?? null,
    item.appliedRuleVersion,
  ];
}

/**
 * Persistência da Enriched Layer para Work Items
 * (tabela `enriched_work_items`, `db/migrations/0014_create_enriched_work_items.sql`).
 *
 * `id` é compartilhado com `canonical_work_items` (mesma PK) — reprocessar
 * um item já enriquecido atualiza a linha existente in-place, nunca duplica.
 *
 * Tenant-scoped: toda operação roda dentro de `withTenantContext` (RLS,
 * Seção 4.3 da spec).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 5.
 */
export class EnrichedWorkItemRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /**
   * Insere ou atualiza um lote de Work Items enriquecidos em uma única
   * transação. Todos os itens devem pertencer ao mesmo tenant.
   *
   * @returns A quantidade de registros persistidos.
   * @throws {Error} Se o lote misturar `tenantId` diferentes.
   */
  async upsertMany(items: readonly EnrichedWorkItem[]): Promise<number> {
    if (items.length === 0) {
      return 0;
    }

    const [{ tenantId }] = items;
    const hasMixedTenants = items.some((item) => item.tenantId !== tenantId);

    if (hasMixedTenants) {
      throw new Error(
        'EnrichedWorkItemRepository.upsertMany: o lote contém tenantId diferentes; cada chamada deve pertencer a um único tenant.',
      );
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      for (const item of items) {
        await client.query(UPSERT_SQL, toQueryParams(item));
      }

      return items.length;
    });
  }
}
