import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

const prisma = new PrismaClient();

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(key);
}

async function resolveStripePriceId(
  stripe: Stripe,
  existing: string | null,
  plan: { name: string; displayName: string; description: string; priceCents: number; currency: string; billingPeriod: string }
): Promise<string | null> {
  // Planos gratuitos não têm price no Stripe
  if (plan.priceCents === 0) return null;

  // Se já existe um price_xxx válido no banco, reutilizar
  if (existing && existing.startsWith('price_')) return existing;

  // Criar product + price automaticamente
  const interval = plan.billingPeriod === 'annual' ? 'year' : 'month';

  const product = await stripe.products.create({
    name: plan.displayName,
    description: plan.description,
    metadata: { plan_name: plan.name }
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: plan.priceCents,
    currency: plan.currency.toLowerCase(),
    recurring: { interval }
  });

  return price.id;
}

const PLANS = [
  {
    name: 'free',
    displayName: 'Free',
    description: 'For individuals and small teams getting started.',
    priceCents: 0,
    currency: 'USD',
    billingPeriod: 'monthly',
    stripePriceId: null,
    modules: ['core', 'integrations', 'dora'],
    maxSeats: 2,
    maxIntegrations: 1,
    historyDays: 30,
    trialDays: 0,
    features: {
      alerts: false,
      api_webhooks: false,
      dora_full_scorecard: false
    },
    isSystem: true,
    isPublic: true,
    isActive: true
  },
  {
    name: 'starter',
    displayName: 'Starter',
    description: 'For growing teams that need more power.',
    priceCents: 4900,
    currency: 'USD',
    billingPeriod: 'monthly',
    stripePriceId: null,
    modules: ['core', 'integrations', 'dora', 'sla', 'comms'],
    maxSeats: 5,
    maxIntegrations: 2,
    historyDays: 90,
    trialDays: 0,
    features: {
      alerts: true,
      api_webhooks: false,
      dora_full_scorecard: true
    },
    isSystem: true,
    isPublic: true,
    isActive: true
  },
  {
    name: 'pro',
    displayName: 'Pro',
    description: 'For scaling engineering teams.',
    priceCents: 14900,
    currency: 'USD',
    billingPeriod: 'monthly',
    stripePriceId: null,
    modules: ['core', 'integrations', 'dora', 'sla', 'cogs', 'comms'],
    maxSeats: 15,
    maxIntegrations: null,
    historyDays: 365,
    trialDays: 14,
    features: {
      alerts: true,
      api_webhooks: true,
      dora_full_scorecard: true
    },
    isSystem: true,
    isPublic: true,
    isActive: true
  },
  {
    name: 'enterprise',
    displayName: 'Enterprise',
    description: 'For large organizations with custom needs.',
    priceCents: 0,
    currency: 'USD',
    billingPeriod: 'monthly',
    stripePriceId: null,
    modules: ['core', 'integrations', 'dora', 'sla', 'cogs', 'intel', 'comms'],
    maxSeats: null,
    maxIntegrations: null,
    historyDays: null,
    trialDays: 0,
    features: {
      alerts: true,
      api_webhooks: true,
      dora_full_scorecard: true
    },
    isSystem: true,
    isPublic: false, // Exclusivo por assignment
    isActive: true
  }
];

async function seedBillingPlans() {
  console.log('🌱 Seeding billing plans...');

  const stripe = getStripe();

  for (const plan of PLANS) {
    // Verificar se já existe para reutilizar o stripePriceId existente
    const existing = await prisma.plan.findUnique({
      where: { name: plan.name },
      select: { stripePriceId: true }
    });

    const stripePriceId = await resolveStripePriceId(stripe, existing?.stripePriceId ?? null, plan);

    const data = { ...plan, stripePriceId };

    await prisma.plan.upsert({
      where: { name: plan.name },
      update: data,
      create: data
    });

    const priceInfo = stripePriceId ? ` (${stripePriceId})` : '';
    console.log(`  ✓ Plan "${plan.name}" created/updated${priceInfo}`);
  }

  // Criar Subscriptions para tenants pré-existentes (se houver)
  const freePlan = await prisma.plan.findFirst({ where: { name: 'free' } });
  if (freePlan) {
    // Buscar tenants sem subscription
    const tenantsWithoutSub = await prisma.$queryRaw<{ tenant_id: string }[]>`
      SELECT t.id as tenant_id
      FROM "Tenant" t
      LEFT JOIN "Subscription" s ON s."tenantId" = t.id
      WHERE s.id IS NULL
    `;

    if (tenantsWithoutSub.length > 0) {
      console.log(`\n🔧 Found ${tenantsWithoutSub.length} tenants without subscription. Creating...`);

      const now = new Date();
      for (const tenant of tenantsWithoutSub) {
        const sub = await prisma.subscription.create({
          data: {
            tenantId: tenant.tenant_id,
            planId: freePlan.id,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + 30 * 86400000)
          }
        });

        await prisma.subscriptionHistory.create({
          data: {
            subscriptionId: sub.id,
            planId: freePlan.id,
            status: 'active',
            effectiveFrom: now,
            reason: 'seed'
          }
        });

        console.log(`  ✓ Subscription created for tenant ${tenant.tenant_id}`);
      }
    } else {
      console.log('\n✓ All existing tenants already have subscriptions');
    }
  }

  console.log('\n✅ Billing seed completed!');
}

seedBillingPlans()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
