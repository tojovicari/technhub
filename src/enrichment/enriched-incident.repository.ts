import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { EnrichedIncident } from './domain-context.types';

const UPSERT_SQL = `
  INSERT INTO enriched_incidents (
    id, tenant_id, team_id, failure_classification, processed_at, applied_rule_version
  )
  VALUES (
    $1, $2, $3, $4, NOW(), $5
  )
  ON CONFLICT (id) DO UPDATE SET
    team_id = EXCLUDED.team_id,
    failure_classification = EXCLUDED.failure_classification,
    processed_at = NOW(),
    applied_rule_version = EXCLUDED.applied_rule_version;
`;

function toQueryParams(incident: EnrichedIncident): unknown[] {
  return [
    incident.id,
    incident.tenantId,
    incident.teamId ?? null,
    incident.failureClassification,
    incident.appliedRuleVersion,
  ];
}

/**
 * Persistência da Enriched Layer para Incidentes
 * (tabela `enriched_incidents`, `db/migrations/0021_create_enriched_incidents.sql`).
 *
 * `id` é compartilhado com `canonical_incidents` (mesma PK) — reprocessar
 * um incidente já enriquecido atualiza a linha existente in-place, nunca
 * duplica. `team_id` pode ser `null` (ver `EnrichedIncident`).
 *
 * Tenant-scoped: toda operação roda dentro de `withTenantContext` (RLS,
 * Seção 4.3 da spec).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 5.
 */
export class EnrichedIncidentRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /**
   * Insere ou atualiza um lote de incidentes enriquecidos em uma única
   * transação. Todos os itens devem pertencer ao mesmo tenant.
   *
   * @returns A quantidade de registros persistidos.
   * @throws {Error} Se o lote misturar `tenantId` diferentes.
   */
  async upsertMany(incidents: readonly EnrichedIncident[]): Promise<number> {
    if (incidents.length === 0) {
      return 0;
    }

    const [{ tenantId }] = incidents;
    const hasMixedTenants = incidents.some((incident) => incident.tenantId !== tenantId);

    if (hasMixedTenants) {
      throw new Error(
        'EnrichedIncidentRepository.upsertMany: o lote contém tenantId diferentes; cada chamada deve pertencer a um único tenant.',
      );
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      for (const incident of incidents) {
        await client.query(UPSERT_SQL, toQueryParams(incident));
      }

      return incidents.length;
    });
  }
}
