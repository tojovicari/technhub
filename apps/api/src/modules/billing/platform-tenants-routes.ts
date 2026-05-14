import type { FastifyInstance } from 'fastify';
import { ok, fail } from '../../lib/http.js';
import {
  listTenantsQuerySchema,
  listSubscriptionHistoryQuerySchema,
  listPlanTenantsQuerySchema,
  patchSubscriptionSchema,
} from './schema.js';
import {
  listTenants,
  getTenantDetail,
  getTenantSubscriptionHistory,
  getPlanTenants,
  patchSubscription,
} from './platform-tenants-service.js';

export async function platformTenantsRoutes(app: FastifyInstance) {
  const readGuard = [app.authenticate, app.requirePlatformRole('super_admin', 'platform_admin')];
  const writeGuard = [app.authenticate, app.requirePlatformRole('super_admin')];

  // ── GET /platform/tenants ─────────────────────────────────────────────────
  app.get(
    '/platform/tenants',
    { preHandler: readGuard },
    async (req, reply) => {
      const parsed = listTenantsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues })
        );
      }

      const result = await listTenants(parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /platform/tenants/:tenant_id ──────────────────────────────────────
  app.get(
    '/platform/tenants/:tenant_id',
    { preHandler: readGuard },
    async (req, reply) => {
      const { tenant_id } = req.params as { tenant_id: string };
      const detail = await getTenantDetail(tenant_id);
      if (!detail) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'Tenant not found'));
      }
      return reply.status(200).send(ok(req, detail));
    }
  );

  // ── GET /platform/tenants/:tenant_id/subscription-history ─────────────────
  app.get(
    '/platform/tenants/:tenant_id/subscription-history',
    { preHandler: readGuard },
    async (req, reply) => {
      const { tenant_id } = req.params as { tenant_id: string };
      const parsed = listSubscriptionHistoryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues })
        );
      }

      const result = await getTenantSubscriptionHistory(tenant_id, parsed.data);
      if (!result) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'Tenant not found'));
      }
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /platform/billing/plans/:plan_id/tenants ──────────────────────────
  app.get(
    '/platform/billing/plans/:plan_id/tenants',
    { preHandler: readGuard },
    async (req, reply) => {
      const { plan_id } = req.params as { plan_id: string };
      const parsed = listPlanTenantsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues })
        );
      }

      const result = await getPlanTenants(plan_id, parsed.data);
      if (!result) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'Plan not found'));
      }
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── PATCH /platform/tenants/:tenant_id/subscription ───────────────────────
  app.patch(
    '/platform/tenants/:tenant_id/subscription',
    { preHandler: writeGuard },
    async (req, reply) => {
      const { tenant_id } = req.params as { tenant_id: string };
      const parsed = patchSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues })
        );
      }

      try {
        const result = await patchSubscription(tenant_id, parsed.data);
        return reply.status(200).send(ok(req, result));
      } catch (error: any) {
        if (error.code === 'NOT_FOUND') {
          return reply.status(404).send(fail(req, 'NOT_FOUND', error.message));
        }
        if (error.code === 'BAD_REQUEST') {
          return reply.status(400).send(fail(req, 'BAD_REQUEST', error.message));
        }
        if (error.code === 'CONFLICT') {
          return reply.status(409).send(
            fail(req, 'CONFLICT', error.message, { conflict_type: error.conflict_type })
          );
        }
        throw error;
      }
    }
  );
}
