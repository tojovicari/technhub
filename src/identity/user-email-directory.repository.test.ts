import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, withTenantContext } from '../database/pool';
import { TenantRepository } from './tenant.repository';
import { UserRepository } from './user.repository';
import { UserEmailDirectoryRepository } from './user-email-directory.repository';

/**
 * `user_email_directory` é a exceção deliberada à regra "tudo tem RLS" —
 * existe justamente pra ser cross-tenant (login SSO-first, ver
 * `auth.routes.ts`). Este teste prova as duas metades do contrato: o
 * dual-write de `UserRepository.create` mantém o índice em dia (mesmo email
 * em tenants diferentes vira 2 linhas), e a tabela responde sem
 * `app.tenant_id` setado (ao contrário de toda tabela RLS do projeto — ver
 * `pull-request.repository.rls.test.ts` pro caso oposto).
 */
describe('UserEmailDirectoryRepository', () => {
  const pool = getPool();
  const tenantRepository = new TenantRepository();
  const userRepository = new UserRepository();
  const emailDirectoryRepository = new UserEmailDirectoryRepository();

  let tenantAId: string;
  let tenantBId: string;
  const sharedEmail = `directory-test-${Date.now()}@example.com`;

  before(async () => {
    const [tenantA, tenantB] = await Promise.all([
      tenantRepository.create({ name: `Directory Test Tenant A ${Date.now()}` }),
      tenantRepository.create({ name: `Directory Test Tenant B ${Date.now()}` }),
    ]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    // Mesmo email nos dois tenants de propósito — é exatamente o caso que
    // motiva a feature (login resolve múltiplos tenants candidatos).
    await userRepository.create(tenantAId, { primaryEmail: sharedEmail, fullName: 'Pessoa A' });
    await userRepository.create(tenantBId, { primaryEmail: sharedEmail, fullName: 'Pessoa B' });
  });

  after(async () => {
    await withTenantContext(pool, tenantAId, (client) =>
      client.query('DELETE FROM users WHERE tenant_id = $1', [tenantAId]),
    );
    await withTenantContext(pool, tenantBId, (client) =>
      client.query('DELETE FROM users WHERE tenant_id = $1', [tenantBId]),
    );
    await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantAId, tenantBId]]);
    await pool.end();
  });

  it('UserRepository.create grava em user_email_directory na mesma transação (dual-write)', async () => {
    const tenantIds = await emailDirectoryRepository.findTenantIdsByEmail(sharedEmail);

    assert.equal(tenantIds.length, 2);
    assert.deepEqual(new Set(tenantIds), new Set([tenantAId, tenantBId]));
  });

  it('responde sem app.tenant_id setado — ao contrário de toda tabela com RLS do projeto', async () => {
    const client = await pool.connect();

    try {
      const result = await client.query('SELECT tenant_id FROM user_email_directory WHERE email = $1', [
        sharedEmail,
      ]);
      assert.equal(result.rows.length, 2);
    } finally {
      client.release();
    }
  });

  it('email sem nenhum usuário cadastrado devolve lista vazia', async () => {
    const tenantIds = await emailDirectoryRepository.findTenantIdsByEmail(`nao-existe-${Date.now()}@example.com`);
    assert.deepEqual(tenantIds, []);
  });
});
