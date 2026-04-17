import type { FastifyInstance } from 'fastify';
import { ok, fail } from '../../lib/http.js';
import {
  checkoutSchema,
  portalSchema,
  listEventsQuerySchema
} from './schema.js';
import {
  listPlansForTenant,
  getSubscription,
  getUsage,
  listBillingEvents,
  createCheckoutSession,
  createPortalSession,
  cancelSubscription
} from './service.js';

function mapPlan(p: any) {
  return {
    id: p.id,
    name: p.name,
    display_name: p.displayName,
    description: p.description,
    price_cents: p.priceCents,
    currency: p.currency,
    billing_period: p.billingPeriod,
    modules: p.modules,
    max_seats: p.maxSeats,
    max_integrations: p.maxIntegrations,
    history_days: p.historyDays,
    trial_days: p.trialDays,
    features: p.features,
    is_public: p.isPublic,
    is_active: p.isActive,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString()
  };
}

function mapSubscription(s: any) {
  return {
    id: s.id,
    tenant_id: s.tenantId,
    plan: mapPlan(s.plan),
    scheduled_downgrade_plan: s.scheduledDowngradePlan ? mapPlan(s.scheduledDowngradePlan) : null,
    pending_plan_changes: s.pendingPlanChanges,
    status: s.status,
    trial_ends_at: s.trialEndsAt?.toISOString() ?? null,
    current_period_start: s.currentPeriodStart.toISOString(),
    current_period_end: s.currentPeriodEnd.toISOString(),
    past_due_since: s.pastDueSince?.toISOString() ?? null,
    downgraded_at: s.downgradedAt?.toISOString() ?? null,
    data_deletion_scheduled_at: s.dataDeletionScheduledAt?.toISOString() ?? null,
    cancelled_at: s.cancelledAt?.toISOString() ?? null,
    provider: s.provider,
    provider_subscription_id: s.providerSubscriptionId,
    provider_customer_id: s.providerCustomerId,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString()
  };
}

function mapEvent(e: any) {
  return {
    id: e.id,
    event_type: e.eventType,
    provider: e.provider,
    occurred_at: e.occurredAt.toISOString(),
    created_at: e.createdAt.toISOString()
  };
}

export async function billingRoutes(app: FastifyInstance) {
  // ── GET /billing/plans ───────────────────────────────────────────────────────
  app.get(
    '/billing/plans',
    async (req, reply) => {
      // Público, mas tenant_id opcional via JWT
      const user = req.user as { tenant_id?: string } | undefined;
      const tenantId = user?.tenant_id;

      if (!tenantId) {
        // Se não autenticado, retornar apenas planos públicos
        const plans = await listPlansForTenant('__public__');
        return reply.status(200).send(ok(req, plans.map(mapPlan)));
      }

      const plans = await listPlansForTenant(tenantId);
      return reply.status(200).send(ok(req, plans.map(mapPlan)));
    }
  );

  // ── GET /billing/subscription ────────────────────────────────────────────────
  app.get(
    '/billing/subscription',
    { preHandler: [app.authenticate, app.requirePermission('billing.read')] },
    async (req, reply) => {
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const subscription = await getSubscription(tenantId);

      if (!subscription) {
        return reply.status(404).send(
          fail(req, 'NOT_FOUND', 'No subscription found for this tenant')
        );
      }

      return reply.status(200).send(ok(req, mapSubscription(subscription)));
    }
  );

  // ── GET /billing/usage ───────────────────────────────────────────────────────
  app.get(
    '/billing/usage',
    { preHandler: [app.authenticate, app.requirePermission('billing.read')] },
    async (req, reply) => {
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const usage = await getUsage(tenantId);

      return reply.status(200).send(ok(req, usage));
    }
  );

  // ── GET /billing/events ──────────────────────────────────────────────────────
  app.get(
    '/billing/events',
    { preHandler: [app.authenticate, app.requirePermission('billing.manage')] },
    async (req, reply) => {
      const parsed = listEventsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues })
        );
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const result = await listBillingEvents(tenantId, parsed.data);

      return reply.status(200).send(ok(req, {
        data: result.data.map(mapEvent),
        next_cursor: result.next_cursor
      }));
    }
  );

  // ── POST /billing/checkout ───────────────────────────────────────────────────
  app.post(
    '/billing/checkout',
    { preHandler: [app.authenticate, app.requirePermission('billing.manage')] },
    async (req, reply) => {
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues })
        );
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;

      try {
        const session = await createCheckoutSession(tenantId, parsed.data.plan_id, {
          success_url: parsed.data.success_url,
          cancel_url: parsed.data.cancel_url
        });

        return reply.status(201).send(ok(req, session));
      } catch (error: any) {
        if (error.code === 'NOT_IMPLEMENTED') {
          return reply.status(501).send(
            fail(req, 'NOT_IMPLEMENTED', 'Stripe integration not yet available')
          );
        }
        throw error;
      }
    }
  );

  // ── POST /billing/portal ─────────────────────────────────────────────────────
  app.post(
    '/billing/portal',
    { preHandler: [app.authenticate, app.requirePermission('billing.manage')] },
    async (req, reply) => {
      const parsed = portalSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues })
        );
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;

      try {
        const session = await createPortalSession(tenantId, parsed.data.return_url);
        return reply.status(201).send(ok(req, session));
      } catch (error: any) {
        if (error.code === 'NOT_IMPLEMENTED') {
          return reply.status(501).send(
            fail(req, 'NOT_IMPLEMENTED', 'Stripe integration not yet available')
          );
        }
        throw error;
      }
    }
  );

  // ── POST /billing/cancel ─────────────────────────────────────────────────────
  app.post(
    '/billing/cancel',
    { preHandler: [app.authenticate, app.requirePermission('billing.manage')] },
    async (req, reply) => {
      const tenantId = (req.user as { tenant_id: string }).tenant_id;

      try {
        const result = await cancelSubscription(tenantId);
        return reply.status(200).send(ok(req, result));
      } catch (error: any) {
        if (error.code === 'NOT_IMPLEMENTED') {
          return reply.status(501).send(
            fail(req, 'NOT_IMPLEMENTED', 'Stripe integration not yet available')
          );
        }
        throw error;
      }
    }
  );
}
