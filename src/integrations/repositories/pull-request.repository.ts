import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../../database/pool';
import type { CanonicalPullRequest } from '../core/canonical.types';

const UPSERT_SQL = `
  INSERT INTO canonical_pull_requests (
    tenant_id, provider, external_id, repository, title, state,
    author_external_id, reviewer_external_ids, source_branch, target_branch,
    lines_added, lines_deleted, comments_count, changed_files,
    first_commit_at, opened_at, merged_at, closed_at, updated_at, synced_at
  )
  VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10,
    $11, $12, $13, $14,
    $15, $16, $17, $18, $19, NOW()
  )
  ON CONFLICT ON CONSTRAINT unique_tenant_provider_repository_pull_request DO UPDATE SET
    title = EXCLUDED.title,
    state = EXCLUDED.state,
    author_external_id = EXCLUDED.author_external_id,
    reviewer_external_ids = EXCLUDED.reviewer_external_ids,
    source_branch = EXCLUDED.source_branch,
    target_branch = EXCLUDED.target_branch,
    lines_added = EXCLUDED.lines_added,
    lines_deleted = EXCLUDED.lines_deleted,
    comments_count = EXCLUDED.comments_count,
    changed_files = EXCLUDED.changed_files,
    first_commit_at = EXCLUDED.first_commit_at,
    opened_at = EXCLUDED.opened_at,
    merged_at = EXCLUDED.merged_at,
    closed_at = EXCLUDED.closed_at,
    updated_at = EXCLUDED.updated_at,
    synced_at = NOW();
`;

function toQueryParams(pullRequest: CanonicalPullRequest): unknown[] {
  return [
    pullRequest.tenantId,
    pullRequest.provider,
    pullRequest.externalId,
    pullRequest.repository,
    pullRequest.title,
    pullRequest.state,
    pullRequest.authorExternalId ?? null,
    pullRequest.reviewerExternalIds,
    pullRequest.sourceBranch,
    pullRequest.targetBranch,
    pullRequest.linesAdded,
    pullRequest.linesDeleted,
    pullRequest.commentsCount,
    pullRequest.changedFiles,
    pullRequest.firstCommitAt ?? null,
    pullRequest.openedAt,
    pullRequest.mergedAt ?? null,
    pullRequest.closedAt ?? null,
    pullRequest.updatedAt,
  ];
}

/**
 * Persistência da Camada Canônica para Pull/Merge Requests
 * (tabela `canonical_pull_requests`, ver `db/migrations/0001_create_canonical_pull_requests.sql`
 * e `0002_add_tenant_scoping_to_canonical_pull_requests.sql`).
 *
 * Toda escrita usa UPSERT sobre a unique constraint
 * `(tenant_id, provider, repository, external_id)`, garantindo que
 * reexecuções de um mesmo lote de sync incremental sejam idempotentes — um
 * PR já conhecido é atualizado in-place, nunca duplicado — e que dois
 * tenants nunca colidam entre si mesmo em providers self-hosted onde o
 * `external_id` isolado não é globalmente único.
 *
 * Toda escrita roda dentro de `withTenantContext`, que define `app.tenant_id`
 * na sessão antes da query — exigido pela policy de Row-Level Security da
 * tabela (`db/migrations/0005_enable_row_level_security_on_canonical_pull_requests.sql`,
 * Seção 4.3 da spec). Sem isso, a policy rejeitaria a própria escrita do
 * repositório.
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 5 (padrão replicado de
 * `canonical_work_items`) e Seção 1, Princípio 1 (Batch First).
 */
export class PullRequestRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /** Insere ou atualiza um único Pull Request canônico. */
  async upsert(pullRequest: CanonicalPullRequest): Promise<void> {
    await withTenantContext(this.pool, pullRequest.tenantId, (client) =>
      client.query(UPSERT_SQL, toQueryParams(pullRequest)),
    );
  }

  /**
   * Insere ou atualiza um lote de Pull Requests canônicos em uma única
   * transação. Se qualquer registro falhar, o lote inteiro é revertido.
   *
   * Todos os itens do lote devem pertencer ao mesmo tenant (é sempre o caso
   * na prática: um lote vem de um único `SyncContext`), já que a sessão só
   * pode ter um `app.tenant_id` ativo por transação.
   *
   * @returns A quantidade de registros persistidos.
   * @throws {Error} Se o lote misturar `tenantId` diferentes.
   */
  async upsertMany(pullRequests: readonly CanonicalPullRequest[]): Promise<number> {
    if (pullRequests.length === 0) {
      return 0;
    }

    const [{ tenantId }] = pullRequests;
    const hasMixedTenants = pullRequests.some((pullRequest) => pullRequest.tenantId !== tenantId);

    if (hasMixedTenants) {
      throw new Error(
        'PullRequestRepository.upsertMany: o lote contém tenantId diferentes; cada chamada deve pertencer a um único tenant.',
      );
    }

    return withTenantContext(this.pool, tenantId, async (client) => {
      for (const pullRequest of pullRequests) {
        await client.query(UPSERT_SQL, toQueryParams(pullRequest));
      }

      return pullRequests.length;
    });
  }

  /**
   * Repositórios (`repository`, formato "owner/repo") já vistos em PRs
   * sincronizados que ainda não estão vinculados a nenhum time da plataforma
   * — alimenta `GET /team-resource-links/candidates?provider=github&resourceType=github_repository`.
   */
  async findUnlinkedRepositories(tenantId: string): Promise<readonly string[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ repository: string }>(
        `SELECT DISTINCT repository
         FROM canonical_pull_requests cpr
         WHERE cpr.tenant_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM team_resource_links trl
             WHERE trl.tenant_id = cpr.tenant_id
               AND trl.provider = 'github'
               AND trl.resource_type = 'github_repository'
               AND trl.external_resource_id = cpr.repository
           )
         ORDER BY repository`,
        [tenantId],
      );

      return result.rows.map((row) => row.repository);
    });
  }
}
