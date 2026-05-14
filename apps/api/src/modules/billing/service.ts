import type Stripe from 'stripe';
import { prisma } from '../../lib/prisma.js';
import { invalidateEntitlementCache } from './entitlement.js';
import { getStripe } from './stripe.js';

// ── Types ────────────────────────────────────────────────────────────────────

type CreatePlanInput = {
  name: string;
  display_name: string;
  description?: string;
  price_cents: number;
  currency: string;
  billing_period: string;
  stripe_price_id?: string;
  modules: string[];
  max_seats: number | null;
  max_integrations: number | null;
  history_days: number | null;
  trial_days: number;
  features: Record<string, boolean>;
  is_public: boolean;
  is_active: boolean;
};

type UpdatePlanInput = {
  display_name?: string;
  description?: string;
  price_cents?: number;
  stripe_price_id?: string;
  modules?: string[];
  max_seats?: number | null;
  max_integrations?: number | null;
  history_days?: number | null;
  trial_days?: number;
  features?: Record<string, boolean>;
  is_public?: boolean;
  is_active?: boolean;
  apply_at_renewal?: boolean;
};

// ── Tenant Functions ─────────────────────────────────────────────────────────

export async function listPlansForTenant(tenantId: string) {
  // Planos públicos + planos exclusivos do tenant
  const publicPlans = await prisma.plan.findMany({
    where: {
      isActive: true,
      isPublic: true
    },
    orderBy: { priceCents: 'asc' }
  });

  const exclusiveAssignments = await prisma.planTenantAssignment.findMany({
    where: { tenantId },
    include: {
      plan: true
    }
  });

  const exclusivePlans = exclusiveAssignments
    .filter(a => a.plan && a.plan.isActive)
    .map(a => a.plan);

  // Combinar e deduplicate
  const allPlans = [...publicPlans, ...exclusivePlans];
  const uniquePlans = Array.from(
    new Map(allPlans.map(p => [p.id, p])).values()
  );

  return uniquePlans;
}

export async function getSubscription(tenantId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    include: {
      plan: true,
      scheduledDowngradePlan: true
    }
  });

  return subscription;
}

export async function getUsage(tenantId: string) {
  // Contar seats (usuários ativos)
  const seatsUsed = await prisma.platformAccount.count({
    where: {
      tenantId,
      isActive: true
    }
  });

  // Contar integrações ativas
  const integrationsUsed = await prisma.integrationConnection.count({
    where: {
      tenantId,
      status: 'active'
    }
  });

  return {
    seats_used: seatsUsed,
    integrations_used: integrationsUsed
  };
}

export async function listBillingEvents(
  tenantId: string,
  filters: {
    event_type?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit: number;
  }
) {
  const where: any = { tenantId };

  if (filters.event_type) {
    where.eventType = filters.event_type;
  }

  if (filters.from || filters.to) {
    where.occurredAt = {};
    if (filters.from) where.occurredAt.gte = new Date(filters.from);
    if (filters.to) where.occurredAt.lte = new Date(filters.to);
  }

  if (filters.cursor) {
    where.id = { lt: filters.cursor };
  }

  const events = await prisma.billingEvent.findMany({
    where,
    orderBy: { occurredAt: 'desc' },
    take: filters.limit + 1
  });

  const hasMore = events.length > filters.limit;
  const data = hasMore ? events.slice(0, -1) : events;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  return { data, next_cursor: nextCursor };
}

// ── Platform Admin Functions ─────────────────────────────────────────────────

export async function listAllPlans(filters: {
  is_active?: string;
  is_public?: string;
  is_system?: string;
  cursor?: string;
  limit: number;
}) {
  const where: any = {};

  if (filters.is_active) where.isActive = filters.is_active === 'true';
  if (filters.is_public) where.isPublic = filters.is_public === 'true';
  if (filters.is_system) where.isSystem = filters.is_system === 'true';
  if (filters.cursor) where.id = { lt: filters.cursor };

  const plans = await prisma.plan.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filters.limit + 1
  });

  // Contar subscriptions ativas para cada plano
  const plansWithCounts = await Promise.all(
    plans.map(async (plan) => {
      const activeSubscriptions = await prisma.subscription.count({
        where: {
          planId: plan.id,
          status: { in: ['trialing', 'active', 'past_due'] }
        }
      });

      return {
        ...plan,
        active_subscriptions_count: activeSubscriptions
      };
    })
  );

  const hasMore = plansWithCounts.length > filters.limit;
  const data = hasMore ? plansWithCounts.slice(0, -1) : plansWithCounts;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  return { data, next_cursor: nextCursor };
}

export async function getPlanById(planId: string) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) return null;

  const activeSubscriptions = await prisma.subscription.count({
    where: {
      planId: plan.id,
      status: { in: ['trialing', 'active', 'past_due'] }
    }
  });

  return { ...plan, active_subscriptions_count: activeSubscriptions };
}

export async function createPlan(input: CreatePlanInput) {
  // Validar core obrigatório
  if (!input.modules?.includes('core')) {
    throw Object.assign(
      new Error('Module "core" is required in all plans'),
      { code: 'VALIDATION_ERROR' }
    );
  }

  // Auto-criar product+price no Stripe para planos pagos sem stripe_price_id explícito
  let stripePriceId = input.stripe_price_id ?? null;
  if (input.price_cents > 0 && !stripePriceId) {
    const stripe = getStripe();
    const interval = input.billing_period === 'annual' ? 'year' : 'month';

    const product = await stripe.products.create({
      name: input.display_name,
      description: input.description,
      metadata: { plan_name: input.name }
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: input.price_cents,
      currency: input.currency.toLowerCase(),
      recurring: { interval }
    });

    stripePriceId = price.id;
  }

  const plan = await prisma.plan.create({
    data: {
      name: input.name,
      displayName: input.display_name,
      description: input.description,
      priceCents: input.price_cents,
      currency: input.currency,
      billingPeriod: input.billing_period,
      stripePriceId,
      modules: input.modules,
      maxSeats: input.max_seats,
      maxIntegrations: input.max_integrations,
      historyDays: input.history_days,
      trialDays: input.trial_days,
      features: input.features,
      isSystem: false, // Planos criados via API nunca são system
      isPublic: input.is_public,
      isActive: input.is_active
    }
  });

  return plan;
}

export async function updatePlan(planId: string, input: UpdatePlanInput) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) return null;

  // Validar core obrigatório se modules foi fornecido
  if (input.modules && !input.modules.includes('core')) {
    throw Object.assign(
      new Error('Module "core" is required in all plans'),
      { code: 'VALIDATION_ERROR' }
    );
  }

  // Contar subscriptions afetadas
  const affectedSubscriptions = await prisma.subscription.count({
    where: {
      planId,
      status: { in: ['trialing', 'active'] }
    }
  });

  // Se apply_at_renewal e há mudanças que reduzem entitlements
  if (input.apply_at_renewal && affectedSubscriptions > 0) {
    // Detectar se é redução (simplificado - apenas armazenar mudanças)
    const changes: any = {};
    if (input.modules) changes.modules = input.modules;
    if (input.max_seats !== undefined) changes.maxSeats = input.max_seats;
    if (input.max_integrations !== undefined) changes.maxIntegrations = input.max_integrations;
    if (input.history_days !== undefined) changes.historyDays = input.history_days;
    if (input.features) changes.features = input.features;

    // Armazenar em subscription.pendingPlanChanges
    await prisma.subscription.updateMany({
      where: {
        planId,
        status: { in: ['trialing', 'active'] }
      },
      data: {
        pendingPlanChanges: changes
      }
    });

    // Não aplicar mudanças no Plan ainda
    return {
      ...plan,
      pending_changes_scheduled: true,
      affected_subscriptions: affectedSubscriptions
    };
  }

  // Aplicar mudanças imediatamente
  const updated = await prisma.plan.update({
    where: { id: planId },
    data: {
      displayName: input.display_name,
      description: input.description,
      priceCents: input.price_cents,
      stripePriceId: input.stripe_price_id,
      modules: input.modules,
      maxSeats: input.max_seats,
      maxIntegrations: input.max_integrations,
      historyDays: input.history_days,
      trialDays: input.trial_days,
      features: input.features,
      isPublic: input.is_public,
      isActive: input.is_active
    }
  });

  // Invalidar cache de todos os tenants afetados
  if (affectedSubscriptions > 0) {
    const subscriptions = await prisma.subscription.findMany({
      where: { planId },
      select: { tenantId: true }
    });
    
    subscriptions.forEach(sub => {
      invalidateEntitlementCache(sub.tenantId);
    });
  }

  return updated;
}

export async function deletePlan(planId: string) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) return null;

  // Não permitir deletar planos de sistema
  if (plan.isSystem) {
    throw Object.assign(
      new Error('Cannot delete system plans'),
      { code: 'FORBIDDEN' }
    );
  }

  // Verificar se há subscriptions ativas
  const activeSubscriptions = await prisma.subscription.count({
    where: {
      planId,
      status: { in: ['trialing', 'active', 'past_due'] }
    }
  });

  if (activeSubscriptions > 0) {
    throw Object.assign(
      new Error('Cannot delete plan with active subscriptions'),
      { code: 'CONFLICT', active_subscriptions: activeSubscriptions }
    );
  }

  await prisma.plan.delete({ where: { id: planId } });
  return true;
}

export async function createAssignment(planId: string, tenantId: string) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    throw Object.assign(
      new Error('Plan not found'),
      { code: 'NOT_FOUND' }
    );
  }

  const assignment = await prisma.planTenantAssignment.create({
    data: { planId, tenantId }
  });

  return assignment;
}

export async function deleteAssignment(planId: string, tenantId: string) {
  const assignment = await prisma.planTenantAssignment.findFirst({
    where: { planId, tenantId }
  });

  if (!assignment) return null;

  await prisma.planTenantAssignment.delete({
    where: { id: assignment.id }
  });

  return true;
}

// ── Revenue Metrics ───────────────────────────────────────────────────────────

type MetricsPeriod = 'last_30d' | 'last_90d' | 'last_12m' | 'mtd' | 'ytd';

function resolvePeriod(period: MetricsPeriod): { start: Date; end: Date } {
  const end = new Date();
  let start: Date;

  if (period === 'last_30d') {
    start = new Date(end.getTime() - 30 * 86_400_000);
  } else if (period === 'last_90d') {
    start = new Date(end.getTime() - 90 * 86_400_000);
  } else if (period === 'last_12m') {
    start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);
  } else if (period === 'mtd') {
    start = new Date(end.getFullYear(), end.getMonth(), 1);
  } else {
    // ytd
    start = new Date(end.getFullYear(), 0, 1);
  }

  return { start, end };
}

export async function getRevenueMetrics(period: MetricsPeriod = 'last_30d') {
  const { start: periodStart, end: periodEnd } = resolvePeriod(period);
  const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'] as const;

  // All currently active subscriptions with plan data
  const activeSubscriptions = await prisma.subscription.findMany({
    where: { status: { in: [...ACTIVE_STATUSES] } },
    include: { plan: true },
  });

  // MRR: sum per subscription
  let mrrCents = 0;
  const byPlanMap = new Map<string, { plan: any; active_subscriptions: number; mrr_cents: number }>();

  for (const sub of activeSubscriptions) {
    const contribution =
      sub.plan.billingPeriod === 'annual'
        ? Math.round(sub.plan.priceCents / 12)
        : sub.plan.priceCents;
    mrrCents += contribution;

    if (!byPlanMap.has(sub.planId)) {
      byPlanMap.set(sub.planId, { plan: sub.plan, active_subscriptions: 0, mrr_cents: 0 });
    }
    const entry = byPlanMap.get(sub.planId)!;
    entry.active_subscriptions++;
    entry.mrr_cents += contribution;
  }

  // Status breakdown
  const statusCounts = await prisma.subscription.groupBy({
    by: ['status'],
    _count: { id: true },
  });
  const byStatus: Record<string, number> = {
    trialing: 0, active: 0, past_due: 0, downgraded: 0, cancelled: 0, expired: 0,
  };
  for (const row of statusCounts) {
    byStatus[row.status] = row._count.id;
  }

  // Period movements
  const [newCount, churnedCount, reactivatedCount, allHistoryInPeriod] = await Promise.all([
    prisma.subscription.count({
      where: { createdAt: { gte: periodStart, lte: periodEnd } },
    }),
    prisma.subscriptionHistory.count({
      where: { status: { in: ['cancelled', 'expired'] }, effectiveFrom: { gte: periodStart, lte: periodEnd } },
    }),
    prisma.billingEvent.count({
      where: { eventType: 'subscription.admin_reactivate', occurredAt: { gte: periodStart, lte: periodEnd } },
    }),
    prisma.subscriptionHistory.findMany({
      where: { effectiveFrom: { gte: periodStart, lte: periodEnd } },
      include: { plan: true },
      orderBy: { effectiveFrom: 'asc' },
    }),
  ]);

  // Upgrades / downgrades: compare plan price against previous entry
  let upgrades = 0;
  let downgrades = 0;

  // Group history entries by subscriptionId
  const historyBySubId = new Map<string, typeof allHistoryInPeriod>();
  for (const h of allHistoryInPeriod) {
    if (!historyBySubId.has(h.subscriptionId)) historyBySubId.set(h.subscriptionId, []);
    historyBySubId.get(h.subscriptionId)!.push(h);
  }

  for (const [subId, entries] of historyBySubId) {
    // Find baseline: most recent entry before periodStart
    const baseline = await prisma.subscriptionHistory.findFirst({
      where: { subscriptionId: subId, effectiveFrom: { lt: periodStart } },
      include: { plan: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!baseline) continue;

    const latestInPeriod = entries[entries.length - 1];
    if (!latestInPeriod.plan) continue;

    const newPrice = latestInPeriod.plan.priceCents;
    const oldPrice = baseline.plan.priceCents;

    if (newPrice > oldPrice) upgrades++;
    else if (newPrice < oldPrice) downgrades++;
  }

  // Churn rate: churned / total_active_at_period_start
  const totalAtStart = await prisma.subscription.count({
    where: { createdAt: { lte: periodStart } },
  });
  const churnRate =
    totalAtStart > 0 ? Math.round((churnedCount / totalAtStart) * 10000) / 100 : 0;

  const byPlan = Array.from(byPlanMap.values()).map((entry) => ({
    plan_id: entry.plan.id,
    plan_name: entry.plan.name,
    plan_display_name: entry.plan.displayName,
    price_cents: entry.plan.priceCents,
    billing_period: entry.plan.billingPeriod,
    active_subscriptions: entry.active_subscriptions,
    mrr_cents: entry.mrr_cents,
  }));

  // Sort by mrr desc
  byPlan.sort((a, b) => b.mrr_cents - a.mrr_cents);

  return {
    period,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    calculated_at: new Date().toISOString(),
    mrr_cents: mrrCents,
    arr_cents: mrrCents * 12,
    subscriptions: {
      total_active: activeSubscriptions.length,
      by_status: byStatus,
    },
    period_movements: {
      new_subscriptions: newCount,
      upgrades,
      downgrades,
      churned: churnedCount,
      reactivated: reactivatedCount,
    },
    churn_rate_percent: churnRate,
    by_plan: byPlan,
  };
}

// ── Stripe Integration ────────────────────────────────────────────────────────

export async function createCheckoutSession(
  tenantId: string,
  planId: string,
  urls: { success_url: string; cancel_url: string }
) {
  const stripe = getStripe();

  // Buscar plano com stripe_price_id
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    throw Object.assign(new Error('Plan not found'), { code: 'NOT_FOUND' });
  }
  if (!plan.stripePriceId) {
    throw Object.assign(
      new Error('This plan has no Stripe price configured'),
      { code: 'VALIDATION_ERROR' }
    );
  }

  // Buscar subscription atual para reutilizar customer
  const subscription = await prisma.subscription.findUnique({ where: { tenantId } });

  // Buscar email do org_admin para criação de customer
  const orgAdmin = await prisma.platformAccount.findFirst({
    where: { tenantId, role: 'org_admin', isActive: true },
    select: { email: true, fullName: true }
  });

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: urls.success_url,
    cancel_url: urls.cancel_url,
    client_reference_id: tenantId,
    metadata: { tenantId, planId },
  };

  if (subscription?.providerCustomerId) {
    sessionParams.customer = subscription.providerCustomerId;
  } else if (orgAdmin?.email) {
    sessionParams.customer_email = orgAdmin.email;
  }

  if (plan.trialDays > 0) {
    sessionParams.subscription_data = { trial_period_days: plan.trialDays };
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return { url: session.url, session_id: session.id };
}

export async function createPortalSession(tenantId: string, returnUrl: string) {
  const stripe = getStripe();

  const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
  if (!subscription?.providerCustomerId) {
    throw Object.assign(
      new Error('No Stripe customer found. Complete a checkout first.'),
      { code: 'PRECONDITION_FAILED' }
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.providerCustomerId,
    return_url: returnUrl,
  });

  return { url: session.url };
}

export async function cancelSubscription(tenantId: string) {
  const stripe = getStripe();

  const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
  if (!subscription) {
    throw Object.assign(new Error('Subscription not found'), { code: 'NOT_FOUND' });
  }

  const now = new Date();

  if (subscription.providerSubscriptionId) {
    // Agendar cancelamento no fim do período via Stripe
    await stripe.subscriptions.update(subscription.providerSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  // Registrar intenção de cancelamento no DB (acesso continua até current_period_end)
  await prisma.subscription.update({
    where: { tenantId },
    data: { cancelledAt: now, status: 'cancelled' }
  });

  await prisma.subscriptionHistory.create({
    data: {
      subscriptionId: subscription.id,
      planId: subscription.planId,
      status: 'cancelled',
      effectiveFrom: now,
      reason: 'cancellation_requested'
    }
  });

  await prisma.billingEvent.create({
    data: {
      tenantId,
      eventType: 'subscription.cancelled',
      provider: subscription.provider ?? null,
      occurredAt: now
    }
  });

  invalidateEntitlementCache(tenantId);
  return { cancelled_at: now.toISOString(), access_until: subscription.currentPeriodEnd.toISOString() };
}
