import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPool } from '../database/pool';
import { TenantRepository } from '../identity/tenant.repository';
import { ProviderIntegrationRepository } from '../integrations/repositories/provider-integration.repository';
import { TeamRepository } from '../identity/team.repository';
import { AlertRepository, RECONNECT_FAILURE_THRESHOLD } from './alert.repository';

/**
 * Roda contra o Postgres local de verdade (mesma `DATABASE_URL` do `.env`)
 * — sem mock, mesmo espírito dos demais testes de repositório do projeto.
 * Cria tenants próprios e limpa tudo no fim.
 */
describe('AlertRepository', () => {
  const pool = getPool();
  const tenantRepository = new TenantRepository();
  const integrationRepository = new ProviderIntegrationRepository();
  const teamRepository = new TeamRepository();
  const alertRepository = new AlertRepository();

  let tenantAId: string;
  let tenantBId: string;
  let integrationId: string;

  before(async () => {
    const [tenantA, tenantB] = await Promise.all([
      tenantRepository.create({ name: `Alert Test Tenant A ${Date.now()}` }),
      tenantRepository.create({ name: `Alert Test Tenant B ${Date.now()}` }),
    ]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    // Alertas ligados a integração têm FK real pra provider_integrations —
    // precisa de uma linha de verdade, não um UUID qualquer.
    const integration = await integrationRepository.create(tenantAId, 'github', 'vcs', { apiToken: 'fake-token' });
    integrationId = integration.id;
  });

  after(async () => {
    await pool.query('DELETE FROM alerts WHERE tenant_id = ANY($1)', [[tenantAId, tenantBId]]);
    // teams.tenant_id não tem ON DELETE CASCADE (diferente de provider_integrations) —
    // precisa limpar antes de apagar o tenant, senão a FK barra o DELETE.
    await pool.query('DELETE FROM teams WHERE tenant_id = ANY($1)', [[tenantAId, tenantBId]]);
    await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantAId, tenantBId]]);
    await pool.end();
  });

  it('isola alertas por tenant (RLS)', async () => {
    await alertRepository.create(tenantAId, {
      type: 'sync_run_finished',
      severity: 'info',
      title: 'Tenant A',
      message: 'alerta do tenant A',
    });
    await alertRepository.create(tenantBId, {
      type: 'sync_run_finished',
      severity: 'info',
      title: 'Tenant B',
      message: 'alerta do tenant B',
    });

    const alertsA = await alertRepository.findAllByTenant(tenantAId);
    const alertsB = await alertRepository.findAllByTenant(tenantBId);

    assert.equal(alertsA.length, 1);
    assert.equal(alertsA[0]?.title, 'Tenant A');
    assert.equal(alertsB.length, 1);
    assert.equal(alertsB[0]?.title, 'Tenant B');
  });

  it('findAllByTenant({ unreadOnly: true }) exclui alertas já lidos', async () => {
    await alertRepository.create(tenantAId, {
      type: 'sync_run_finished',
      severity: 'info',
      title: 'Não lido',
      message: 'x',
    });
    await alertRepository.create(tenantAId, {
      type: 'sync_run_finished',
      severity: 'info',
      title: 'Vai ser lido',
      message: 'x',
    });

    const before2 = await alertRepository.findAllByTenant(tenantAId, { unreadOnly: true });
    const toMarkRead = before2.find((a) => a.title === 'Vai ser lido');
    assert.ok(toMarkRead);

    const marked = await alertRepository.markRead(tenantAId, toMarkRead.id);
    assert.equal(marked, true);

    const afterUnread = await alertRepository.findAllByTenant(tenantAId, { unreadOnly: true });
    assert.ok(!afterUnread.some((a) => a.id === toMarkRead.id));
  });

  it('hasOpenAlert / resolveOpenAlerts: dedup e fechamento sem apagar a linha', async () => {
    await alertRepository.create(tenantAId, {
      type: 'sync_stale',
      severity: 'warning',
      title: 'Sync desatualizada',
      message: 'x',
      integrationId,
    });

    assert.equal(await alertRepository.hasOpenAlert(tenantAId, 'sync_stale', integrationId), true);

    await alertRepository.resolveOpenAlerts(tenantAId, 'sync_stale', integrationId);

    assert.equal(await alertRepository.hasOpenAlert(tenantAId, 'sync_stale', integrationId), false);

    const all = await alertRepository.findAllByTenant(tenantAId);
    const resolved = all.find((a) => a.integrationId === integrationId && a.type === 'sync_stale');
    assert.ok(resolved);
    assert.ok(resolved.resolvedAt !== null);
  });

  it('evaluateReconnectionAlert: só cria no limiar, não duplica, resolve com 0', async () => {
    for (let failures = 1; failures < RECONNECT_FAILURE_THRESHOLD; failures += 1) {
      await alertRepository.evaluateReconnectionAlert(tenantAId, integrationId, 'github', failures);
      assert.equal(
        await alertRepository.hasOpenAlert(tenantAId, 'integration_reconnect_required', integrationId),
        false,
        `não deveria existir alerta com ${failures} falha(s)`,
      );
    }

    await alertRepository.evaluateReconnectionAlert(tenantAId, integrationId, 'github', RECONNECT_FAILURE_THRESHOLD);
    assert.equal(
      await alertRepository.hasOpenAlert(tenantAId, 'integration_reconnect_required', integrationId),
      true,
    );

    // Falha adicional acima do limiar não deve duplicar o alerta aberto.
    await alertRepository.evaluateReconnectionAlert(
      tenantAId,
      integrationId,
      'github',
      RECONNECT_FAILURE_THRESHOLD + 1,
    );
    const openAlerts = (await alertRepository.findAllByTenant(tenantAId)).filter(
      (a) => a.type === 'integration_reconnect_required' && a.integrationId === integrationId && a.resolvedAt === null,
    );
    assert.equal(openAlerts.length, 1);

    await alertRepository.evaluateReconnectionAlert(tenantAId, integrationId, 'github', 0);
    assert.equal(
      await alertRepository.hasOpenAlert(tenantAId, 'integration_reconnect_required', integrationId),
      false,
    );
  });

  it('evaluateOnboardingAlert: só cria quando 0 times e ≤1 usuário, resolve quando qualquer um deixa de valer', async () => {
    await alertRepository.evaluateOnboardingAlert(tenantAId, 0, 1);
    assert.equal(await alertRepository.hasOpenAlert(tenantAId, 'onboarding_incomplete', null), true);

    // Reavaliar com a mesma condição não deve duplicar.
    await alertRepository.evaluateOnboardingAlert(tenantAId, 0, 1);
    const open = (await alertRepository.findAllByTenant(tenantAId)).filter(
      (a) => a.type === 'onboarding_incomplete' && a.resolvedAt === null,
    );
    assert.equal(open.length, 1);

    // Ganhar um time resolve, mesmo com userCount ainda ≤1.
    await alertRepository.evaluateOnboardingAlert(tenantAId, 1, 1);
    assert.equal(await alertRepository.hasOpenAlert(tenantAId, 'onboarding_incomplete', null), false);
  });

  it('evaluateTeamContributorsAlert: cria por time sem membro, resolve quando ganha um', async () => {
    const team = await teamRepository.create(tenantAId, { name: `Time sem contribuidor ${Date.now()}` });

    await alertRepository.evaluateTeamContributorsAlert(tenantAId, team.id, team.name, false);
    assert.equal(await alertRepository.hasOpenAlert(tenantAId, 'team_without_contributors', null, team.id), true);

    // Reavaliar sem mudança não duplica.
    await alertRepository.evaluateTeamContributorsAlert(tenantAId, team.id, team.name, false);
    const open = (await alertRepository.findAllByTenant(tenantAId)).filter(
      (a) => a.type === 'team_without_contributors' && a.teamId === team.id && a.resolvedAt === null,
    );
    assert.equal(open.length, 1);

    await alertRepository.evaluateTeamContributorsAlert(tenantAId, team.id, team.name, true);
    assert.equal(await alertRepository.hasOpenAlert(tenantAId, 'team_without_contributors', null, team.id), false);
  });

  it('evaluateResourceLimitAlert: cria no limiar, não duplica, resolve abaixo do limite, nunca cria sem limite', async () => {
    await alertRepository.evaluateResourceLimitAlert(tenantAId, 'teams_limit_reached', 2, 3);
    assert.equal(
      await alertRepository.hasOpenAlert(tenantAId, 'teams_limit_reached', null),
      false,
      'abaixo do limite não deveria criar',
    );

    await alertRepository.evaluateResourceLimitAlert(tenantAId, 'teams_limit_reached', 3, 3);
    assert.equal(await alertRepository.hasOpenAlert(tenantAId, 'teams_limit_reached', null), true);

    // Reavaliar no limite (ou acima) não duplica.
    await alertRepository.evaluateResourceLimitAlert(tenantAId, 'teams_limit_reached', 4, 3);
    const open = (await alertRepository.findAllByTenant(tenantAId)).filter(
      (a) => a.type === 'teams_limit_reached' && a.resolvedAt === null,
    );
    assert.equal(open.length, 1);

    await alertRepository.evaluateResourceLimitAlert(tenantAId, 'teams_limit_reached', 2, 3);
    assert.equal(await alertRepository.hasOpenAlert(tenantAId, 'teams_limit_reached', null), false);

    // limit === null (ilimitado) nunca cria, mesmo com contagem alta.
    await alertRepository.evaluateResourceLimitAlert(tenantAId, 'users_limit_reached', 999, null);
    assert.equal(await alertRepository.hasOpenAlert(tenantAId, 'users_limit_reached', null), false);
  });
});
