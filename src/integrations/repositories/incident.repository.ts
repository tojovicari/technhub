import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../../database/pool';
import type { CanonicalIncident } from '../core/canonical.types';

/** Um `CanonicalIncident` já persistido, com o `id` gerado pelo banco (necessário pra Enriched Layer). */
export interface PersistedIncident extends CanonicalIncident {
  readonly id: string;
}

interface IncidentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly provider: CanonicalIncident['provider'];
  readonly external_id: string;
  readonly title: string;
  readonly severity: CanonicalIncident['severity'];
  readonly status: CanonicalIncident['status'];
  readonly service_name: string | null;
  readonly external_team_id: string | null;
  readonly external_team_name: string | null;
  readonly assignee_external_id: string | null;
  readonly triggered_at: Date;
  readonly acknowledged_at: Date | null;
  readonly resolved_at: Date | null;
}

function mapRowToPersistedIncident(row: IncidentRow): PersistedIncident {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    externalId: row.external_id,
    title: row.title,
    severity: row.severity,
    status: row.status,
    serviceName: row.service_name,
    externalTeamId: row.external_team_id,
    externalTeamName: row.external_team_name,
    assigneeExternalId: row.assignee_external_id,
    triggeredAt: row.triggered_at,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
  };
}

const UPSERT_SQL = `
  INSERT INTO canonical_incidents (
    tenant_id, provider, external_id, title, severity, status,
    service_name, external_team_id, external_team_name, assignee_external_id,
    triggered_at, acknowledged_at, resolved_at, synced_at
  )
  VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10,
    $11, $12, $13, NOW()
  )
  ON CONFLICT ON CONSTRAINT unique_tenant_provider_incident DO UPDATE SET
    title = EXCLUDED.title,
    severity = EXCLUDED.severity,
    status = EXCLUDED.status,
    service_name = EXCLUDED.service_name,
    external_team_id = EXCLUDED.external_team_id,
    external_team_name = EXCLUDED.external_team_name,
    assignee_external_id = EXCLUDED.assignee_external_id,
    acknowledged_at = EXCLUDED.acknowledged_at,
    resolved_at = EXCLUDED.resolved_at,
    synced_at = NOW();
`;

function toQueryParams(incident: CanonicalIncident): unknown[] {
  return [
    incident.tenantId,
    incident.provider,
    incident.externalId,
    incident.title,
    incident.severity,
    incident.status,
    incident.serviceName ?? null,
    incident.externalTeamId ?? null,
    incident.externalTeamName ?? null,
    incident.assigneeExternalId ?? null,
    incident.triggeredAt,
    incident.acknowledgedAt ?? null,
    incident.resolvedAt ?? null,
  ];
}

/**
 * Persistência da Camada Canônica para Incidentes
 * (tabela `canonical_incidents`, ver `db/migrations/0015_create_canonical_incidents.sql`).
 *
 * Toda escrita usa UPSERT sobre a unique constraint
 * `(tenant_id, provider, external_id)`, garantindo que reexecuções de um
 * mesmo lote de sync incremental sejam idempotentes.
 *
 * Toda escrita roda dentro de `withTenantContext` (RLS, Seção 4.3 da spec).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 5.
 */
export class IncidentRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /** Insere ou atualiza um único incidente canônico. */
  async upsert(incident: CanonicalIncident): Promise<void> {
    await withTenantContext(this.pool, incident.tenantId, (client) =>
      client.query(UPSERT_SQL, toQueryParams(incident)),
    );
  }

  /**
   * Insere ou atualiza um lote de incidentes canônicos em uma única
   * transação. Todos os itens devem pertencer ao mesmo tenant.
   *
   * @returns A quantidade de registros persistidos.
   * @throws {Error} Se o lote misturar `tenantId` diferentes.
   */
  async upsertMany(incidents: readonly CanonicalIncident[]): Promise<number> {
    if (incidents.length === 0) {
      return 0;
    }

    const [{ tenantId }] = incidents;
    const hasMixedTenants = incidents.some((incident) => incident.tenantId !== tenantId);

    if (hasMixedTenants) {
      throw new Error(
        'IncidentRepository.upsertMany: o lote contém tenantId diferentes; cada chamada deve pertencer a um único tenant.',
      );
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      for (const incident of incidents) {
        await client.query(UPSERT_SQL, toQueryParams(incident));
      }

      return incidents.length;
    });
  }

  /** Lista todos os incidentes canônicos de um provider — usado pela Enriched Layer. */
  async findByProvider(tenantId: string, provider: string): Promise<readonly PersistedIncident[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<IncidentRow>(
        `SELECT id, tenant_id, provider, external_id, title, severity, status, service_name,
                external_team_id, external_team_name, assignee_external_id,
                triggered_at, acknowledged_at, resolved_at
         FROM canonical_incidents
         WHERE tenant_id = $1 AND provider = $2`,
        [tenantId, provider],
      );

      return result.rows.map(mapRowToPersistedIncident);
    });
  }

  /**
   * Times externos (`external_team_id`/`external_team_name`, resolvidos via
   * Waroom service→team) já vistos em incidentes sincronizados que ainda
   * não estão vinculados a nenhum time da plataforma — alimenta
   * `GET /team-resource-links/candidates?provider=waroom&resourceType=waroom_team`.
   */
  async findUnlinkedExternalTeams(
    tenantId: string,
  ): Promise<readonly { readonly externalTeamId: string; readonly externalTeamName: string | null }[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ external_team_id: string; external_team_name: string | null }>(
        `SELECT DISTINCT external_team_id, external_team_name
         FROM canonical_incidents ci
         WHERE ci.tenant_id = $1
           AND ci.external_team_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM team_resource_links trl
             WHERE trl.tenant_id = ci.tenant_id
               AND trl.provider = 'waroom'
               AND trl.resource_type = 'waroom_team'
               AND trl.external_resource_id = ci.external_team_id
           )
         ORDER BY external_team_name NULLS LAST, external_team_id`,
        [tenantId],
      );

      return result.rows.map((row) => ({
        externalTeamId: row.external_team_id,
        externalTeamName: row.external_team_name,
      }));
    });
  }
}
