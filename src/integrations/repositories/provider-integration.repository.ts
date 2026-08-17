import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../../database/pool';
import type { ProviderCategory, ProviderCredentials } from '../core/canonical.types';

type IntegrationStatus = 'ACTIVE' | 'ERROR' | 'DISABLED';

interface IntegrationSummaryRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly provider: string;
  readonly category: ProviderCategory;
  readonly status: IntegrationStatus;
  readonly team_id: string | null;
  readonly last_cursor: string | null;
  readonly last_synced_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface IntegrationSummary {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly category: ProviderCategory;
  readonly status: IntegrationStatus;
  /** Time da plataforma ao qual os dados desse provider pertencem — usado pela Enriched Layer. */
  readonly teamId: string | null;
  readonly lastCursor: string | null;
  readonly lastSyncedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const SUMMARY_COLUMNS =
  'id, tenant_id, provider, category, status, team_id, last_cursor, last_synced_at, created_at, updated_at';

function mapRowToSummary(row: IntegrationSummaryRow): IntegrationSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    category: row.category,
    status: row.status,
    teamId: row.team_id,
    lastCursor: row.last_cursor,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface DecryptedIntegration {
  readonly credentials: ProviderCredentials;
  readonly lastCursor: string | null;
  readonly lastSyncedAt: Date | null;
  /** Estado derivado cacheado, análogo a `lastCursor` — hoje só usado pelo Jira (id do custom field de Epic Link). `undefined` = nunca resolvido; `null` = já resolvido, o site não tem esse campo. */
  readonly epicLinkFieldId: string | null | undefined;
}

function requireEncryptionKey(): string {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;

  if (!key) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY não está definida — necessária para cifrar/decifrar credenciais de integração.',
    );
  }

  return key;
}

/**
 * Persistência da tabela `provider_integrations` (`db/migrations/0004_create_provider_integrations.sql`).
 *
 * Credenciais nunca trafegam nem ficam em repouso em texto puro: são
 * cifradas via `pgcrypto` (`pgp_sym_encrypt`/`pgp_sym_decrypt`) com uma
 * chave lida de `INTEGRATION_ENCRYPTION_KEY`, nunca de uma migration ou
 * versionada. `IntegrationSummary` nunca inclui a credencial.
 *
 * Tenant-scoped: toda operação roda dentro de `withTenantContext` para
 * satisfazer a policy de Row-Level Security da tabela (Seção 4.3 da spec).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 4.2.
 */
export class ProviderIntegrationRepository {
  constructor(
    private readonly pool: Pool = getPool(),
    private readonly encryptionKey: string = requireEncryptionKey(),
  ) {}

  /**
   * Cadastra uma nova integração para um tenant. Sempre cria uma linha nova
   * — um tenant pode ter várias integrações do mesmo provider (ex: dois
   * boards Jira, cada um com seu `teamId`), então não há mais upsert por
   * `(tenant_id, provider)`. Para corrigir/trocar credenciais ou `teamId` de
   * uma integração já existente, ver `update`.
   */
  async create(
    tenantId: string,
    provider: string,
    category: ProviderCategory,
    credentials: ProviderCredentials,
    teamId?: string,
  ): Promise<IntegrationSummary> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<IntegrationSummaryRow>(
        `INSERT INTO provider_integrations (tenant_id, provider, category, encrypted_credentials, team_id)
         VALUES ($1, $2, $3, pgp_sym_encrypt($4, $5), $6)
         RETURNING ${SUMMARY_COLUMNS}`,
        [tenantId, provider, category, JSON.stringify(credentials), this.encryptionKey, teamId ?? null],
      );

      return mapRowToSummary(result.rows[0]);
    });
  }

  /**
   * Atualiza parcialmente uma integração já existente (credenciais e/ou
   * `teamId`). Campos omitidos preservam o valor atual. Retorna `null` se a
   * integração não existir neste tenant.
   */
  async update(
    tenantId: string,
    integrationId: string,
    patch: { readonly credentials?: ProviderCredentials; readonly teamId?: string | null },
  ): Promise<IntegrationSummary | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const encryptedCredentials =
        patch.credentials !== undefined ? JSON.stringify(patch.credentials) : null;

      const result = await client.query<IntegrationSummaryRow>(
        `UPDATE provider_integrations
         SET encrypted_credentials = CASE WHEN $3::text IS NOT NULL THEN pgp_sym_encrypt($3::text, $4) ELSE encrypted_credentials END,
             team_id = CASE WHEN $5::boolean THEN $6::uuid ELSE team_id END,
             status = CASE WHEN $3::text IS NOT NULL THEN 'ACTIVE' ELSE status END,
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${SUMMARY_COLUMNS}`,
        [
          tenantId,
          integrationId,
          encryptedCredentials,
          this.encryptionKey,
          patch.teamId !== undefined,
          patch.teamId ?? null,
        ],
      );

      return result.rows.length === 0 ? null : mapRowToSummary(result.rows[0]);
    });
  }

  /** Remove uma integração. `false` se ela não existia neste tenant. */
  async delete(tenantId: string, integrationId: string): Promise<boolean> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query('DELETE FROM provider_integrations WHERE tenant_id = $1 AND id = $2', [
        tenantId,
        integrationId,
      ]);

      return (result.rowCount ?? 0) > 0;
    });
  }

  /** Carrega o resumo de uma integração (sem credenciais) pelo `id`, ou `null` se não houver. */
  async getById(tenantId: string, integrationId: string): Promise<IntegrationSummary | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<IntegrationSummaryRow>(
        `SELECT ${SUMMARY_COLUMNS} FROM provider_integrations WHERE tenant_id = $1 AND id = $2`,
        [tenantId, integrationId],
      );

      return result.rows.length === 0 ? null : mapRowToSummary(result.rows[0]);
    });
  }

  /** Lista o resumo de todas as integrações do tenant (sem credenciais) — usado pela tela de back office. */
  async listByTenant(tenantId: string): Promise<readonly IntegrationSummary[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<IntegrationSummaryRow>(
        `SELECT ${SUMMARY_COLUMNS} FROM provider_integrations WHERE tenant_id = $1 ORDER BY provider, created_at`,
        [tenantId],
      );

      return result.rows.map(mapRowToSummary);
    });
  }

  /** Usado pelo gate de limite de plano (`billing.service.ts`) — mais barato que `listByTenant(...).length`. */
  async countByTenant(tenantId: string): Promise<number> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM provider_integrations WHERE tenant_id = $1',
        [tenantId],
      );

      return Number(result.rows[0].count);
    });
  }

  /** Carrega e decifra a credencial cadastrada pelo `id`, ou `null` se não houver integração. */
  async getDecryptedCredentialsById(tenantId: string, integrationId: string): Promise<DecryptedIntegration | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{
        decrypted_credentials: string;
        last_cursor: string | null;
        last_synced_at: Date | null;
        epic_link_field_id: string | null;
        epic_link_field_resolved: boolean;
      }>(
        `SELECT pgp_sym_decrypt(encrypted_credentials, $3) AS decrypted_credentials, last_cursor, last_synced_at,
                epic_link_field_id, epic_link_field_resolved
         FROM provider_integrations
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, integrationId, this.encryptionKey],
      );

      if (result.rows.length === 0) {
        return null;
      }

      const {
        decrypted_credentials: decryptedCredentials,
        last_cursor: lastCursor,
        last_synced_at: lastSyncedAt,
        epic_link_field_id: epicLinkFieldId,
        epic_link_field_resolved: epicLinkFieldResolved,
      } = result.rows[0];
      return {
        credentials: JSON.parse(decryptedCredentials) as ProviderCredentials,
        lastCursor,
        lastSyncedAt,
        // `undefined` = nunca resolvido, provider deve tentar descobrir de novo.
        epicLinkFieldId: epicLinkFieldResolved ? epicLinkFieldId : undefined,
      };
    });
  }

  /**
   * Atualiza status/cursor/timestamp de sync após uma execução de
   * `syncIncremental`. Em caso de sucesso, `last_cursor` é sempre
   * sobrescrito (mesmo `null`, o que significa "sem mais páginas").
   *
   * `last_synced_at` só avança quando `nextCursor` é `null` — ou seja,
   * quando a paginação **termina de verdade**, não a cada página individual.
   * Isso importa porque `last_synced_at` alimenta o filtro `since` da
   * próxima chamada: se avançasse a cada página, o `since` mudaria entre a
   * página 1 e a página 2 da MESMA sincronização, fazendo a query de busca
   * (JQL no Jira, `q` no GitHub, etc.) ficar diferente da que gerou o cursor
   * — no caso do Jira isso quebra com `400` (o `nextPageToken` é validado
   * contra a JQL original); nos outros providers seria mais silencioso
   * (resultado inconsistente entre páginas), mas o mesmo bug de fundo. Uma
   * falha (`success: false`) preserva ambos os campos, pelo mesmo motivo já
   * documentado: não avançar `since` sobre dado nunca efetivamente
   * sincronizado.
   *
   * Exceção deliberada: `outcome.cursorInvalidated` (ver `SyncResult`) —
   * quando o próprio cursor é a causa da falha (ex: `nextPageToken` do Jira
   * expirado), retê-lo só garante que a próxima tentativa falhe do mesmo
   * jeito pra sempre (foi exatamente o que aconteceu numa integração real,
   * travada por mais de um ano até alguém notar). Nesse caso `last_cursor`
   * é limpo mesmo com `success: false`, pra próxima tentativa recomeçar a
   * janela do zero em vez de repetir o cursor morto.
   */
  async markSyncOutcome(
    tenantId: string,
    integrationId: string,
    outcome: {
      readonly success: boolean;
      readonly nextCursor?: string | null;
      readonly cursorInvalidated?: boolean;
      readonly epicLinkFieldId?: string | null;
    },
  ): Promise<{ readonly consecutiveFailures: number }> {
    const status: IntegrationStatus = outcome.success ? 'ACTIVE' : 'ERROR';
    const nextCursor = outcome.nextCursor ?? null;
    const shouldClearCursor = outcome.success || outcome.cursorInvalidated === true;
    // `undefined` = provider não tentou resolver nesta execução (não é Jira,
    // ou já tinha resolvido antes e nem reportou de novo) — não mexe nas
    // colunas. Presente (mesmo `null`) = resolução de verdade aconteceu
    // agora, grava e marca como resolvido pra nunca mais tentar.
    const epicLinkFieldAttempted = outcome.epicLinkFieldId !== undefined;

    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ consecutive_failures: number }>(
        `UPDATE provider_integrations
         SET status = $3::varchar,
             last_cursor = CASE WHEN $5 THEN $4 ELSE last_cursor END,
             last_synced_at = CASE WHEN $3::varchar = 'ACTIVE' AND $4 IS NULL THEN NOW() ELSE last_synced_at END,
             consecutive_failures = CASE WHEN $3::varchar = 'ACTIVE' THEN 0 ELSE consecutive_failures + 1 END,
             epic_link_field_id = CASE WHEN $6 THEN $7 ELSE epic_link_field_id END,
             epic_link_field_resolved = CASE WHEN $6 THEN true ELSE epic_link_field_resolved END,
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2
         RETURNING consecutive_failures`,
        [tenantId, integrationId, status, nextCursor, shouldClearCursor, epicLinkFieldAttempted, outcome.epicLinkFieldId ?? null],
      );
      return { consecutiveFailures: result.rows[0]?.consecutive_failures ?? 0 };
    });
  }

  /**
   * Força a integração a rodar backfill completo de novo — só zera
   * `last_cursor`/`last_synced_at` (o par que `SyncContext.since`/`cursor`
   * usa pra escolher `syncSincePage`/`syncBackfillPage`, ver
   * `integrations.routes.ts`/`internal.routes.ts`), sem mexer em
   * `epic_link_field_id`/`epic_link_field_resolved` (já resolvido, não
   * precisa de nova descoberta) nem em `status`/`consecutive_failures`
   * (isto não é uma falha). Existe pra recapturar campos novos que uma
   * migration adicionou (`parent_external_id`, ver migration 0054, "sem
   * backfill") em itens que nenhuma sync incremental jamais voltaria a
   * tocar sozinha (só re-busca o que mudou no provider desde `since`).
   *
   * Só reseta uma integração que já **terminou** um backfill
   * (`last_synced_at IS NOT NULL`, condição no `WHERE`) — nunca reseta um
   * backfill em andamento, senão perde o progresso do cursor e reinicia
   * do zero pra sempre se chamado de novo antes de terminar.
   */
  async resetSyncState(tenantId: string, integrationId: string): Promise<'reset' | 'in_progress' | 'not_found'> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE provider_integrations SET last_cursor = NULL, last_synced_at = NULL, updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 AND last_synced_at IS NOT NULL`,
        [tenantId, integrationId],
      );

      if ((result.rowCount ?? 0) > 0) {
        return 'reset';
      }

      const exists = await client.query(`SELECT 1 FROM provider_integrations WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        integrationId,
      ]);
      return (exists.rowCount ?? 0) > 0 ? 'in_progress' : 'not_found';
    });
  }
}
