import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPool } from '../database/pool';
import { TenantRepository } from '../identity/tenant.repository';
import { PlanRepository } from './plan.repository';
import { EnterpriseCheckoutLinkRepository } from './enterprise-checkout-link.repository';

/**
 * Roda contra o Postgres local de verdade (mesma `DATABASE_URL` do `.env`)
 * — sem mock, mesmo padrão dos demais testes de repositório do projeto.
 * Cria tenant/plano próprios e limpa tudo no fim.
 */
describe('EnterpriseCheckoutLinkRepository', () => {
  const pool = getPool();
  const tenantRepository = new TenantRepository();
  const planRepository = new PlanRepository();
  const linkRepository = new EnterpriseCheckoutLinkRepository();

  let tenantAId: string;
  let tenantBId: string;
  let planId: string;

  before(async () => {
    const [tenantA, tenantB, plan] = await Promise.all([
      tenantRepository.create({ name: `Enterprise Link Test Tenant A ${Date.now()}` }),
      tenantRepository.create({ name: `Enterprise Link Test Tenant B ${Date.now()}` }),
      planRepository.create({
        name: `enterprise-test-${Date.now()}`,
        displayName: 'Enterprise Test',
        priceCents: 99900,
        currency: 'usd',
        billingPeriod: 'monthly',
        stripePriceId: null,
        trialDays: 0,
        isPublic: false,
        isActive: true,
      }),
    ]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    planId = plan.id;
  });

  after(async () => {
    await pool.query('DELETE FROM enterprise_checkout_links WHERE tenant_id = ANY($1)', [[tenantAId, tenantBId]]);
    await pool.query('DELETE FROM plans WHERE id = $1', [planId]);
    await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantAId, tenantBId]]);
    await pool.end();
  });

  it('isola links por tenant (RLS) e lista mais recente primeiro', async () => {
    await linkRepository.create(tenantAId, {
      planId,
      contactEmail: 'a@example.com',
      stripeCheckoutSessionId: `cs_test_a_${Date.now()}`,
      checkoutUrl: 'https://checkout.stripe.com/a',
      createdByOperatorEmail: 'operator@example.com',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await linkRepository.create(tenantBId, {
      planId,
      contactEmail: 'b@example.com',
      stripeCheckoutSessionId: `cs_test_b_${Date.now()}`,
      checkoutUrl: 'https://checkout.stripe.com/b',
      createdByOperatorEmail: 'operator@example.com',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const linksA = await linkRepository.findAllByTenant(tenantAId);
    const linksB = await linkRepository.findAllByTenant(tenantBId);

    assert.equal(linksA.length, 1);
    assert.equal(linksA[0]?.contactEmail, 'a@example.com');
    assert.equal(linksA[0]?.status, 'pending');
    assert.equal(linksB.length, 1);
    assert.equal(linksB[0]?.contactEmail, 'b@example.com');
  });

  it('markPaid: só afeta linha pending com o session id certo, idempotente', async () => {
    const sessionId = `cs_test_paid_${Date.now()}`;
    const link = await linkRepository.create(tenantAId, {
      planId,
      contactEmail: 'paid@example.com',
      stripeCheckoutSessionId: sessionId,
      checkoutUrl: 'https://checkout.stripe.com/paid',
      createdByOperatorEmail: 'operator@example.com',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    assert.equal(link.status, 'pending');

    const marked = await linkRepository.markPaid(tenantAId, sessionId);
    assert.equal(marked, true);

    const [afterMark] = (await linkRepository.findAllByTenant(tenantAId)).filter((l) => l.id === link.id);
    assert.equal(afterMark?.status, 'paid');
    assert.ok(afterMark?.paidAt !== null);

    // Idempotente: chamar de novo não encontra mais uma linha `pending`.
    const markedAgain = await linkRepository.markPaid(tenantAId, sessionId);
    assert.equal(markedAgain, false);

    // Session id desconhecido não afeta nada (caso do checkout self-service normal).
    const unrelated = await linkRepository.markPaid(tenantAId, 'cs_test_unrelated');
    assert.equal(unrelated, false);
  });

  it('markExpired: só afeta linha pending', async () => {
    const sessionId = `cs_test_expired_${Date.now()}`;
    await linkRepository.create(tenantAId, {
      planId,
      contactEmail: 'expired@example.com',
      stripeCheckoutSessionId: sessionId,
      checkoutUrl: 'https://checkout.stripe.com/expired',
      createdByOperatorEmail: 'operator@example.com',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const marked = await linkRepository.markExpired(tenantAId, sessionId);
    assert.equal(marked, true);

    const markedAgain = await linkRepository.markExpired(tenantAId, sessionId);
    assert.equal(markedAgain, false);
  });
});
