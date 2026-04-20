import type { FastifyInstance } from 'fastify';
import { ok, fail } from '../../lib/http.js';
import {
  createPlanSchema,
  updatePlanSchema,
  listPlansQuerySchema,
  createAssignmentSchema
} from './schema.js';
import {
  listAllPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  createAssignment,
  deleteAssignment
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
    stripe_price_id: p.stripePriceId,
    modules: p.modules,
    max_seats: p.maxSeats,
    max_integrations: p.maxIntegrations,
    history_days: p.historyDays,
    trial_days: p.trialDays,
    features: p.features,
    is_system: p.isSystem,
    is_public: p.isPublic,
    is_active: p.isActive,
    active_subscriptions_count: p.active_subscriptions_count,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString()
  };
}

export async function platformBillingRoutes(app: FastifyInstance) {
  const guard = [app.authenticate, app.requirePlatformRole('super_admin', 'platform_admin')];

  // ── GET /platform/billing/plans ──────────────────────────────────────────────
  app.get(
    '/platform/billing/plans',
    { preHandler: guard },
    async (req, reply) => {
      const parsed = listPlansQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues })
        );
      }

      const result = await listAllPlans(parsed.data);

      return reply.status(200).send(ok(req, {
        data: result.data.map(mapPlan),
        next_cursor: result.next_cursor
      }));
    }
  );

  // ── POST /platform/billing/plans ─────────────────────────────────────────────
  app.post(
    '/platform/billing/plans',
    { preHandler: guard },
    async (req, reply) => {
      const parsed = createPlanSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues })
        );
      }

      try {
        const plan = await createPlan(parsed.data);
        return reply.status(201).send(ok(req, mapPlan({ ...plan, active_subscriptions_count: 0 })));
      } catch (error: any) {
        if (error.code === 'VALIDATION_ERROR') {
          return reply.status(400).send(fail(req, 'BAD_REQUEST', error.message));
        }
        if (error.code === 'P2002') {
          return reply.status(409).send(
            fail(req, 'CONFLICT', 'A plan with this name already exists')
          );
        }
        throw error;
      }
    }
  );

  // ── GET /platform/billing/plans/:plan_id ─────────────────────────────────────
  app.get(
    '/platform/billing/plans/:plan_id',
    { preHandler: guard },
    async (req, reply) => {
      const { plan_id } = req.params as { plan_id: string };

      const plan = await getPlanById(plan_id);
      if (!plan) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'Plan not found'));
      }

      return reply.status(200).send(ok(req, mapPlan(plan)));
    }
  );

  // ── PATCH /platform/billing/plans/:plan_id ───────────────────────────────────
  app.patch(
    '/platform/billing/plans/:plan_id',
    { preHandler: guard },
    async (req, reply) => {
      const { plan_id } = req.params as { plan_id: string };
      const parsed = updatePlanSchema.safeParse(req.body);

      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues })
        );
      }

      try {
        const plan = await updatePlan(plan_id, parsed.data);

        if (!plan) {
          return reply.status(404).send(fail(req, 'NOT_FOUND', 'Plan not found'));
        }

        // Se retornou pending_changes_scheduled, incluir no response
        if ('pending_changes_scheduled' in plan) {
          return reply.status(200).send(ok(req, {
            ...mapPlan(plan),
            pending_changes_scheduled: true,
            affected_subscriptions: plan.affected_subscriptions
          }));
        }

        return reply.status(200).send(ok(req, mapPlan({ ...plan, active_subscriptions_count: 0 })));
      } catch (error: any) {
        if (error.code === 'VALIDATION_ERROR') {
          return reply.status(400).send(fail(req, 'BAD_REQUEST', error.message));
        }
        throw error;
      }
    }
  );

  // ── DELETE /platform/billing/plans/:plan_id ──────────────────────────────────
  app.delete(
    '/platform/billing/plans/:plan_id',
    { preHandler: guard },
    async (req, reply) => {
      const { plan_id } = req.params as { plan_id: string };

      try {
        const result = await deletePlan(plan_id);

        if (!result) {
          return reply.status(404).send(fail(req, 'NOT_FOUND', 'Plan not found'));
        }

        return reply.status(204).send();
      } catch (error: any) {
        if (error.code === 'FORBIDDEN') {
          return reply.status(403).send(fail(req, 'FORBIDDEN', error.message));
        }
        if (error.code === 'CONFLICT') {
          return reply.status(409).send(
            fail(req, 'CONFLICT', error.message, {
              active_subscriptions: error.active_subscriptions
            })
          );
        }
        throw error;
      }
    }
  );

  // ── POST /platform/billing/plans/:plan_id/assignments ────────────────────────
  app.post(
    '/platform/billing/plans/:plan_id/assignments',
    { preHandler: guard },
    async (req, reply) => {
      const { plan_id } = req.params as { plan_id: string };
      const parsed = createAssignmentSchema.safeParse(req.body);

      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues })
        );
      }

      try {
        const assignment = await createAssignment(plan_id, parsed.data.tenant_id);

        return reply.status(201).send(ok(req, {
          id: assignment.id,
          plan_id: assignment.planId,
          tenant_id: assignment.tenantId,
          created_at: assignment.createdAt.toISOString()
        }));
      } catch (error: any) {
        if (error.code === 'NOT_FOUND') {
          return reply.status(404).send(fail(req, 'NOT_FOUND', error.message));
        }
        if (error.code === 'P2002') {
          return reply.status(409).send(
            fail(req, 'CONFLICT', 'Assignment already exists')
          );
        }
        throw error;
      }
    }
  );

  // ── DELETE /platform/billing/plans/:plan_id/assignments/:tenant_id ──────────
  app.delete(
    '/platform/billing/plans/:plan_id/assignments/:tenant_id',
    { preHandler: guard },
    async (req, reply) => {
      const { plan_id, tenant_id } = req.params as { plan_id: string; tenant_id: string };

      const result = await deleteAssignment(plan_id, tenant_id);

      if (!result) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'Assignment not found'));
      }

      return reply.status(204).send();
    }
  );
}
