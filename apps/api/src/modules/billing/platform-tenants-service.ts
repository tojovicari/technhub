import { prisma } from '../../lib/prisma.js';
import { invalidateEntitlementCache } from './entitlement.js';
import { getStripe } from './stripe.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeMrr(priceCents: number, billingPeriod: string): number {
  if (billingPeriod === 'annual') return Math.round(priceCents / 12);
  return priceCents;
}

function mapPlanSummary(plan: any) {
  return {
    id: plan.id,
    name: plan.name,
    display_name: plan.displayName,
    price_cents: plan.priceCents,
    billing_period: plan.billingPeriod,
  };
}

function mapSubscriptionBase(sub: any) {
  return {
    id: sub.id,
    status: sub.status,
    plan: mapPlanSummary(sub.plan),
    current_period_end: sub.currentPeriodEnd.toISOString(),
    trial_ends_at: sub.trialEndsAt?.toISOString() ?? null,
    past_due_since: sub.pastDueSince?.toISOString() ?? null,
    cancelled_at: sub.cancelledAt?.toISOString() ?? null,
  };
}

async function getUsageForTenant(tenantId: string) {
  const [seats_used, integrations_used] = await Promise.all([
    prisma.platformAccount.count({ where: { tenantId, isActive: true } }),
    prisma.integrationConnection.count({ where: { tenantId, status: 'active' } }),
  ]);
  return { seats_used, integrations_used };
}

// ── Module A: Tenant Listing ──────────────────────────────────────────────────

export async function listTenants(filters: {
  status?: string;
  plan_id?: string;
  search?: string;
  cursor?: string;
  limit: number;
}) {
  const { status, plan_id, search, cursor, limit } = filters;

  let tenantItems: Array<{ tenant: any; subscription: any }> = [];
  let nextCursor: string | null = null;

  if (status || plan_id) {
    // Via A: filter-first (through subscriptions)
    const subWhere: any = {};
    if (status) subWhere.status = status;
    if (plan_id) subWhere.planId = plan_id;
    if (cursor) subWhere.id = { lt: cursor };

    const subscriptions = await prisma.subscription.findMany({
      where: subWhere,
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const tenantIds = subscriptions.map((s) => s.tenantId);

    const tenantWhere: any = { id: { in: tenantIds } };
    if (search && search.length >= 2) {
      tenantWhere.AND = [
        { id: { in: tenantIds } },
        { OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { slug: { contains: search, mode: 'insensitive' } },
        ] },
      ];
      delete tenantWhere.id;
    }

    const tenants = await prisma.tenant.findMany({ where: tenantWhere });
    const tenantMap = Object.fromEntries(tenants.map((t) => [t.id, t]));

    const hasMore = subscriptions.length > limit;
    const page = hasMore ? subscriptions.slice(0, -1) : subscriptions;

    tenantItems = page
      .filter((s) => tenantMap[s.tenantId] !== undefined)
      .map((s) => ({ tenant: tenantMap[s.tenantId], subscription: s }));

    nextCursor = hasMore ? page[page.length - 1].id : null;
  } else {
    // Via B: tenant-first
    const tenantWhere: any = {};
    if (search && search.length >= 2) {
      tenantWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (cursor) tenantWhere.id = { lt: cursor };

    const tenants = await prisma.tenant.findMany({
      where: tenantWhere,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = tenants.length > limit;
    const page = hasMore ? tenants.slice(0, -1) : tenants;
    const tenantIds = page.map((t) => t.id);

    const subscriptions = await prisma.subscription.findMany({
      where: { tenantId: { in: tenantIds } },
      include: { plan: true },
    });
    const subMap = Object.fromEntries(subscriptions.map((s) => [s.tenantId, s]));

    tenantItems = page.map((t) => ({ tenant: t, subscription: subMap[t.id] ?? null }));
    nextCursor = hasMore ? page[page.length - 1].id : null;
  }

  // Batch usage + account counts for all tenants
  const tenantIds = tenantItems.map((item) => item.tenant.id);

  const [usages, accountCounts] = await Promise.all([
    Promise.all(tenantIds.map((id) => getUsageForTenant(id))),
    prisma.platformAccount
      .groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds }, isActive: true },
        _count: { id: true },
      })
      .then((rows) => Object.fromEntries(rows.map((r) => [r.tenantId, r._count.id]))),
  ]);

  const usageMap = Object.fromEntries(tenantIds.map((id, i) => [id, usages[i]]));

  const data = tenantItems.map(({ tenant, subscription }) => ({
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    created_at: tenant.createdAt.toISOString(),
    subscription: subscription ? mapSubscriptionBase(subscription) : null,
    usage: usageMap[tenant.id],
    accounts_count: accountCounts[tenant.id] ?? 0,
    mrr_cents: subscription
      ? computeMrr(subscription.plan.priceCents, subscription.plan.billingPeriod)
      : 0,
  }));

  return { data, next_cursor: nextCursor };
}

export async function getTenantDetail(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;

  const [subscription, accounts, recentEvents, usage] = await Promise.all([
    prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true, scheduledDowngradePlan: true },
    }),
    prisma.platformAccount.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    prisma.billingEvent.findMany({
      where: { tenantId },
      orderBy: { occurredAt: 'desc' },
      take: 5,
    }),
    getUsageForTenant(tenantId),
  ]);

  const accountsCount = accounts.filter((a) => a.isActive).length;
  const mrr = subscription
    ? computeMrr(subscription.plan.priceCents, subscription.plan.billingPeriod)
    : 0;

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    created_at: tenant.createdAt.toISOString(),
    subscription: subscription
      ? {
          ...mapSubscriptionBase(subscription),
          grace_extension_days: subscription.graceExtensionDays,
          downgraded_at: subscription.downgradedAt?.toISOString() ?? null,
          data_deletion_scheduled_at: subscription.dataDeletionScheduledAt?.toISOString() ?? null,
          scheduled_downgrade_plan: subscription.scheduledDowngradePlan
            ? mapPlanSummary(subscription.scheduledDowngradePlan)
            : null,
          pending_plan_changes: subscription.pendingPlanChanges,
        }
      : null,
    usage,
    accounts_count: accountsCount,
    mrr_cents: mrr,
    accounts: accounts.map((a) => ({
      id: a.id,
      email: a.email,
      full_name: a.fullName,
      role: a.role,
      is_active: a.isActive,
      last_login_at: a.lastLoginAt?.toISOString() ?? null,
      created_at: a.createdAt.toISOString(),
    })),
    recent_events: recentEvents.map((e) => ({
      id: e.id,
      event_type: e.eventType,
      provider: e.provider,
      occurred_at: e.occurredAt.toISOString(),
    })),
  };
}

export async function getTenantSubscriptionHistory(
  tenantId: string,
  filters: { cursor?: string; limit: number }
) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;

  const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
  if (!subscription) return { data: [], next_cursor: null };

  const where: any = { subscriptionId: subscription.id };
  if (filters.cursor) {
    where.effectiveFrom = { lt: new Date(filters.cursor) };
  }

  const history = await prisma.subscriptionHistory.findMany({
    where,
    include: { plan: true },
    orderBy: { effectiveFrom: 'desc' },
    take: filters.limit + 1,
  });

  const hasMore = history.length > filters.limit;
  const page = hasMore ? history.slice(0, -1) : history;

  return {
    data: page.map((h) => ({
      id: h.id,
      subscription_id: h.subscriptionId,
      plan: mapPlanSummary(h.plan),
      status: h.status,
      effective_from: h.effectiveFrom.toISOString(),
      reason: h.reason ?? null,
      created_at: h.createdAt.toISOString(),
    })),
    next_cursor: hasMore ? page[page.length - 1].effectiveFrom.toISOString() : null,
  };
}

export async function getPlanTenants(
  planId: string,
  filters: { status?: string; cursor?: string; limit: number }
) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) return null;

  const where: any = { planId };
  if (filters.status) where.status = filters.status;
  if (filters.cursor) where.id = { lt: filters.cursor };

  const subscriptions = await prisma.subscription.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filters.limit + 1,
  });

  const hasMore = subscriptions.length > filters.limit;
  const page = hasMore ? subscriptions.slice(0, -1) : subscriptions;
  const tenantIds = page.map((s) => s.tenantId);

  const tenants = await prisma.tenant.findMany({ where: { id: { in: tenantIds } } });
  const tenantMap = Object.fromEntries(tenants.map((t) => [t.id, t]));

  const data = page
    .filter((s) => tenantMap[s.tenantId])
    .map((s) => {
      const t = tenantMap[s.tenantId];
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        subscription_id: s.id,
        subscription_status: s.status,
        current_period_end: s.currentPeriodEnd.toISOString(),
        created_at: t.createdAt.toISOString(),
      };
    });

  return { data, next_cursor: hasMore ? page[page.length - 1].id : null };
}

// ── Module B: Subscription Management ───────────────────────────────────────

export async function patchSubscription(
  tenantId: string,
  body: {
    action: 'extend_grace' | 'reactivate' | 'cancel';
    reason: string;
    extension_days?: number;
  }
) {
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });

  if (!subscription) {
    const err: any = new Error('No subscription found for this tenant');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const now = new Date();

  // ── extend_grace ──────────────────────────────────────────────────────────
  if (body.action === 'extend_grace') {
    if (subscription.status !== 'past_due') {
      const err: any = new Error('Subscription must be past_due to extend grace period');
      err.code = 'CONFLICT';
      err.conflict_type = 'invalid_status_for_action';
      throw err;
    }
    if (!body.extension_days) {
      const err: any = new Error('extension_days is required for extend_grace');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const newGraceDays = subscription.graceExtensionDays + body.extension_days;
    await prisma.subscription.update({
      where: { tenantId },
      data: { graceExtensionDays: newGraceDays },
    });
    await prisma.billingEvent.create({
      data: { tenantId, eventType: 'subscription.admin_extend_grace', occurredAt: now },
    });

    const pastDueSince = subscription.pastDueSince!;
    const graceExpiresAt = new Date(pastDueSince.getTime() + (10 + newGraceDays) * 86_400_000);

    return {
      action: 'extend_grace',
      tenant_id: tenantId,
      subscription_id: subscription.id,
      grace_extension_days: newGraceDays,
      past_due_since: pastDueSince.toISOString(),
      grace_expires_at: graceExpiresAt.toISOString(),
    };
  }

  // ── reactivate ────────────────────────────────────────────────────────────
  if (body.action === 'reactivate') {
    if (subscription.status !== 'downgraded') {
      const err: any = new Error('Subscription must be downgraded to reactivate');
      err.code = 'CONFLICT';
      err.conflict_type = 'invalid_status_for_action';
      throw err;
    }

    const newPeriodEnd = new Date(now.getTime() + 30 * 86_400_000);
    const updated = await prisma.subscription.update({
      where: { tenantId },
      data: {
        status: 'active',
        downgradedAt: null,
        dataDeletionScheduledAt: null,
        pastDueSince: null,
        graceExtensionDays: 0,
        currentPeriodStart: now,
        currentPeriodEnd: newPeriodEnd,
      },
    });

    await Promise.all([
      prisma.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          planId: subscription.planId,
          status: 'active',
          effectiveFrom: now,
          reason: body.reason,
        },
      }),
      prisma.billingEvent.create({
        data: { tenantId, eventType: 'subscription.admin_reactivate', occurredAt: now },
      }),
    ]);
    await invalidateEntitlementCache(tenantId);

    return {
      action: 'reactivate',
      tenant_id: tenantId,
      subscription_id: subscription.id,
      status: 'active',
      current_period_start: updated.currentPeriodStart.toISOString(),
      current_period_end: updated.currentPeriodEnd.toISOString(),
    };
  }

  // ── cancel ────────────────────────────────────────────────────────────────
  if (body.action === 'cancel') {
    const CANCELLABLE = ['trialing', 'active', 'past_due'];
    if (!CANCELLABLE.includes(subscription.status)) {
      const err: any = new Error('Subscription cannot be cancelled from its current status');
      err.code = 'CONFLICT';
      err.conflict_type = 'invalid_status_for_action';
      throw err;
    }

    const freePlan = await prisma.plan.findFirst({
      where: { isSystem: true, priceCents: 0, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    // Cancel on Stripe if subscription is provider-managed (fire-and-forget, non-blocking)
    if (subscription.providerSubscriptionId) {
      try {
        const stripe = getStripe();
        await stripe.subscriptions.cancel(subscription.providerSubscriptionId);
      } catch {
        // Log but don't fail the admin action — DB is the source of truth
      }
    }

    await prisma.subscription.update({
      where: { tenantId },
      data: {
        status: 'cancelled',
        cancelledAt: now,
        scheduledDowngradePlanId: freePlan?.id ?? null,
      },
    });

    await Promise.all([
      prisma.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          planId: subscription.planId,
          status: 'cancelled',
          effectiveFrom: now,
          reason: body.reason,
        },
      }),
      prisma.billingEvent.create({
        data: { tenantId, eventType: 'subscription.admin_cancel', occurredAt: now },
      }),
    ]);
    await invalidateEntitlementCache(tenantId);

    return {
      action: 'cancel',
      tenant_id: tenantId,
      subscription_id: subscription.id,
      status: 'cancelled',
      cancelled_at: now.toISOString(),
    };
  }

  const err: any = new Error('Invalid action');
  err.code = 'BAD_REQUEST';
  throw err;
}
