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
   * Incidente a incidente (não agregado, diferente de
   * `DashboardService.queryMeanTimeToRestore`) dentro de uma janela, filtrado
   * por time via `enriched_incidents.team_id` — mesmo join, granularidade
   * diferente. Usado só por `TeamTimelineService` (ver plano: sem rota HTTP
   * própria, pra não recriar o problema de "mais uma chamada" que o
   * endpoint consolidado existe pra evitar).
   */
  async findInRangeByTeam(
    tenantId: string,
    teamId: string,
    from: Date,
    to: Date,
  ): Promise<
    readonly {
      readonly title: string;
      readonly severity: CanonicalIncident['severity'];
      readonly status: CanonicalIncident['status'];
      readonly triggeredAt: Date;
      readonly resolvedAt: Date | null;
    }[]
  > {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{
        title: string;
        severity: CanonicalIncident['severity'];
        status: CanonicalIncident['status'];
        triggered_at: Date;
        resolved_at: Date | null;
      }>(
        `SELECT ci.title, ci.severity, ci.status, ci.triggered_at, ci.resolved_at
         FROM canonical_incidents ci
         JOIN enriched_incidents ei ON ei.id = ci.id
         WHERE ei.team_id = $1 AND ci.triggered_at BETWEEN $2 AND $3
         ORDER BY ci.triggered_at ASC`,
        [teamId, from, to],
      );

      return result.rows.map((row) => ({
        title: row.title,
        severity: row.severity,
        status: row.status,
        triggeredAt: row.triggered_at,
        resolvedAt: row.resolved_at,
      }));
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

  /**
   * Apaga em lotes de até `batchSize` — `enriched_incidents`
   * correspondente some junto via `ON DELETE CASCADE`
   * (`0021_create_enriched_incidents.sql`). Chamado em loop pelo
   * `RetentionPurgeService` até devolver `0`. `triggered_at` é a data
   * "quando isso aconteceu" desta tabela.
   */
  async purgeOlderThan(tenantId: string, cutoff: Date, batchSize: number): Promise<number> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM canonical_incidents
         WHERE id IN (
           SELECT id FROM canonical_incidents WHERE tenant_id = $1 AND triggered_at < $2 LIMIT $3
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
        `SELECT 1 FROM canonical_incidents WHERE tenant_id = $1 AND triggered_at < $2 LIMIT 1`,
        [tenantId, cutoff],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }
}
