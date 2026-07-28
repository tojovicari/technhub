import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../../database/pool';
import type { CanonicalDiscoveredIdentity } from '../core/canonical.types';

/** Um `CanonicalDiscoveredIdentity` já persistido, com o `id` gerado pelo banco. */
export interface PersistedDiscoveredIdentity extends CanonicalDiscoveredIdentity {
  readonly id: string;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

interface DiscoveredIdentityRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly provider: CanonicalDiscoveredIdentity['provider'];
  readonly external_user_id: string;
  readonly external_username: string | null;
  readonly external_email: string | null;
  readonly external_avatar_url: string | null;
  readonly first_seen_at: Date;
  readonly last_seen_at: Date;
}

function mapRowToPersistedDiscoveredIdentity(row: DiscoveredIdentityRow): PersistedDiscoveredIdentity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    externalUserId: row.external_user_id,
    externalUsername: row.external_username,
    externalEmail: row.external_email,
    externalAvatarUrl: row.external_avatar_url,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

const UPSERT_SQL = `
  INSERT INTO discovered_identities (
    tenant_id, provider, external_user_id, external_username, external_email, external_avatar_url
  )
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT ON CONSTRAINT unique_tenant_provider_external_identity DO UPDATE SET
    -- COALESCE evita que um sync que não conseguiu resolver username/email/avatar
    -- desta vez (ex: Jira sem permissão de exibir email pra este accountId)
    -- apague um valor já conhecido de uma sincronização anterior.
    external_username = COALESCE(EXCLUDED.external_username, discovered_identities.external_username),
    external_email = COALESCE(EXCLUDED.external_email, discovered_identities.external_email),
    external_avatar_url = COALESCE(EXCLUDED.external_avatar_url, discovered_identities.external_avatar_url),
    last_seen_at = NOW();
`;

function toQueryParams(identity: CanonicalDiscoveredIdentity): unknown[] {
  return [
    identity.tenantId,
    identity.provider,
    identity.externalUserId,
    identity.externalUsername ?? null,
    identity.externalEmail ?? null,
    identity.externalAvatarUrl ?? null,
  ];
}

/**
 * Persistência de `discovered_identities`
 * (ver `db/migrations/0022_create_discovered_identities.sql`).
 *
 * Staging table de identidades externas vistas durante o sync (autor de PR,
 * assignee de issue/incidente, quem disparou um deploy) que ainda não têm
 * um `User` correspondente na plataforma — alimenta
 * GET /tenants/:tenantId/discovered-users.
 *
 * Toda escrita roda dentro de `withTenantContext` (RLS, Seção 4.3 da spec).
 */
export class DiscoveredIdentityRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /**
   * Insere ou atualiza um lote de identidades descobertas em uma única
   * transação. Todos os itens devem pertencer ao mesmo tenant.
   *
   * @returns A quantidade de registros persistidos.
   * @throws {Error} Se o lote misturar `tenantId` diferentes.
   */
  async upsertMany(identities: readonly CanonicalDiscoveredIdentity[]): Promise<number> {
    if (identities.length === 0) {
      return 0;
    }

    const [{ tenantId }] = identities;
    const hasMixedTenants = identities.some((identity) => identity.tenantId !== tenantId);

    if (hasMixedTenants) {
      throw new Error(
        'DiscoveredIdentityRepository.upsertMany: o lote contém tenantId diferentes; cada chamada deve pertencer a um único tenant.',
      );
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      for (const identity of identities) {
        await client.query(UPSERT_SQL, toQueryParams(identity));
      }

      return identities.length;
    });
  }

  /**
   * IDs externos já conhecidos para este tenant+provider — usado pelo
   * `SyncOrchestrator` pra popular `SyncContext.knownExternalUserIds`
   * antes de chamar `provider.syncIncremental`.
   */
  async listExternalIdsByProvider(tenantId: string, provider: string): Promise<ReadonlySet<string>> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ external_user_id: string }>(
        `SELECT external_user_id FROM discovered_identities WHERE tenant_id = $1 AND provider = $2`,
        [tenantId, provider],
      );

      return new Set(result.rows.map((row) => row.external_user_id));
    });
  }

  /**
   * Busca um lote de identidades descobertas por `id` — usado por
   * `POST /tenants/:tenantId/discovered-users/materialize` pra resolver
   * `provider`/`externalUserId`/`externalUsername`/`externalEmail` de cada
   * identidade a mesclar num único `users`.
   */
  async findManyByIds(tenantId: string, ids: readonly string[]): Promise<readonly PersistedDiscoveredIdentity[]> {
    if (ids.length === 0) {
      return [];
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<DiscoveredIdentityRow>(
        `SELECT id, tenant_id, provider, external_user_id, external_username, external_email, external_avatar_url,
                first_seen_at, last_seen_at
         FROM discovered_identities
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, ids],
      );

      return result.rows.map(mapRowToPersistedDiscoveredIdentity);
    });
  }

  /**
   * Candidatos a convite: identidades descobertas que ainda não têm um
   * `user_provider_aliases` correspondente. Usado por
   * GET /tenants/:tenantId/discovered-users.
   */
  async listCandidates(tenantId: string): Promise<readonly PersistedDiscoveredIdentity[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<DiscoveredIdentityRow>(
        `SELECT di.id, di.tenant_id, di.provider, di.external_user_id, di.external_username,
                di.external_email, di.external_avatar_url, di.first_seen_at, di.last_seen_at
         FROM discovered_identities di
         WHERE di.tenant_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM user_provider_aliases upa
             WHERE upa.tenant_id = di.tenant_id
               AND upa.provider = di.provider
               AND upa.external_user_id = di.external_user_id
           )
         ORDER BY di.last_seen_at DESC`,
        [tenantId],
      );

      return result.rows.map(mapRowToPersistedDiscoveredIdentity);
    });
  }
}
