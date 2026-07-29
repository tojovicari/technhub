import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, withTenantContext } from '../../database/pool';
import { TenantRepository } from '../../identity/tenant.repository';
import { PullRequestRepository } from './pull-request.repository';
import type { CanonicalPullRequest } from '../core/canonical.types';

/**
 * Formaliza a verificação de RLS já feita manualmente com curl/psql (Seção
 * 4.3 da spec): dois tenants nunca veem dado um do outro, mesmo que o
 * `external_id` colida, e nenhuma query passa sem `app.tenant_id` setado.
 *
 * Roda contra o Postgres local de verdade (mesma `DATABASE_URL` do `.env`)
 * — sem mock de banco, mesmo espírito de "testar contra sistema real" que
 * guiou a sessão inteira. Cria tenants/PRs próprios e limpa tudo no fim.
 */
describe('RLS em canonical_pull_requests', () => {
  const pool = getPool();
  const tenantRepository = new TenantRepository();
  const pullRequestRepository = new PullRequestRepository();

  let tenantAId: string;
  let tenantBId: string;
  const sharedExternalId = `rls-test-${Date.now()}`;

  before(async () => {
    const [tenantA, tenantB] = await Promise.all([
      tenantRepository.create({ name: `RLS Test Tenant A ${Date.now()}` }),
      tenantRepository.create({ name: `RLS Test Tenant B ${Date.now()}` }),
    ]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const basePullRequest = {
      provider: 'github' as const,
      externalId: sharedExternalId,
      repository: 'rls-test/repo',
      title: 'RLS test PR',
      state: 'OPEN' as const,
      authorExternalId: null,
      reviewerExternalIds: [],
      sourceBranch: 'feature',
      targetBranch: 'main',
      linesAdded: 1,
      linesDeleted: 0,
      commentsCount: 0,
      changedFiles: [],
      firstCommitAt: null,
      openedAt: new Date(),
      mergedAt: null,
      closedAt: null,
      updatedAt: new Date(),
    };

    // Mesmo external_id nos dois tenants de propósito: prova que é a RLS (e
    // não só a constraint de unicidade) que impede um tenant de ver o dado
    // do outro — a constraint (tenant_id, provider, repository, external_id)
    // permite essa colisão porque tenant_id difere.
    await pullRequestRepository.upsert({ ...basePullRequest, tenantId: tenantAId } satisfies CanonicalPullRequest);
    await pullRequestRepository.upsert({ ...basePullRequest, tenantId: tenantBId } satisfies CanonicalPullRequest);
  });

  after(async () => {
    await withTenantContext(pool, tenantAId, (client) =>
      client.query('DELETE FROM canonical_pull_requests WHERE tenant_id = $1', [tenantAId]),
    );
    await withTenantContext(pool, tenantBId, (client) =>
      client.query('DELETE FROM canonical_pull_requests WHERE tenant_id = $1', [tenantBId]),
    );
    await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantAId, tenantBId]]);
    await pool.end();
  });

  it('tenant A só enxerga o próprio PR, mesmo com external_id colidindo com o do tenant B', async () => {
    const result = await withTenantContext(pool, tenantAId, (client) =>
      client.query('SELECT tenant_id FROM canonical_pull_requests WHERE external_id = $1', [sharedExternalId]),
    );

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].tenant_id, tenantAId);
  });

  it('tenant B só enxerga o próprio PR', async () => {
    const result = await withTenantContext(pool, tenantBId, (client) =>
      client.query('SELECT tenant_id FROM canonical_pull_requests WHERE external_id = $1', [sharedExternalId]),
    );

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].tenant_id, tenantBId);
  });

  it('query sem app.tenant_id setado falha (RLS fecha por padrão, não abre)', async () => {
    const client = await pool.connect();

    try {
      await assert.rejects(() =>
        client.query('SELECT tenant_id FROM canonical_pull_requests WHERE external_id = $1', [sharedExternalId]),
      );
    } finally {
      client.release();
    }
  });
});
