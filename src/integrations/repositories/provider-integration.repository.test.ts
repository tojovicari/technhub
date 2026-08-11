import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPool } from '../../database/pool';
import { TenantRepository } from '../../identity/tenant.repository';
import { ProviderIntegrationRepository } from './provider-integration.repository';

/**
 * Cobre o contador `consecutive_failures` (`db/migrations/0047_...sql`),
 * introduzido pra alimentar o alerta `integration_reconnect_required`
 * (`src/alerts/alert.repository.ts`) — `provider_integrations.status`
 * sozinho não distingue uma falha isolada de uma sequência.
 *
 * Roda contra o Postgres local de verdade, mesmo padrão dos demais testes
 * de repositório do projeto (sem mock).
 */
describe('ProviderIntegrationRepository.markSyncOutcome — consecutive_failures', () => {
  const pool = getPool();
  const tenantRepository = new TenantRepository();
  const integrationRepository = new ProviderIntegrationRepository();

  let tenantId: string;
  let integrationId: string;

  before(async () => {
    const tenant = await tenantRepository.create({ name: `Integration Test Tenant ${Date.now()}` });
    tenantId = tenant.id;

    const integration = await integrationRepository.create(tenantId, 'github', 'vcs', { apiToken: 'fake-token' });
    integrationId = integration.id;
  });

  after(async () => {
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await pool.end();
  });

  it('incrementa a cada falha e reseta a 0 no próximo sucesso', async () => {
    const first = await integrationRepository.markSyncOutcome(tenantId, integrationId, { success: false });
    assert.equal(first.consecutiveFailures, 1);

    const second = await integrationRepository.markSyncOutcome(tenantId, integrationId, { success: false });
    assert.equal(second.consecutiveFailures, 2);

    const third = await integrationRepository.markSyncOutcome(tenantId, integrationId, { success: false });
    assert.equal(third.consecutiveFailures, 3);

    const recovered = await integrationRepository.markSyncOutcome(tenantId, integrationId, {
      success: true,
      nextCursor: null,
    });
    assert.equal(recovered.consecutiveFailures, 0);
  });
});
