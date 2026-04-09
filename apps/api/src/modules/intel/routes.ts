import type { FastifyInstance } from 'fastify';
import { ok, fail } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import {
  velocityForecastQuerySchema,
  epicForecastParamsSchema,
  slaRiskQuerySchema,
  anomaliesQuerySchema,
  recommendationsQuerySchema,
  capacityQuerySchema
} from './schema.js';
import {
  getVelocityForecast,
  getEpicCompletionForecast,
  getSlaRisk,
  getAnomalies,
  getRecommendations,
  getCapacity
} from './service.js';

export async function intelRoutes(app: FastifyInstance) {
  // ── GET /intel/velocity/forecast ─────────────────────────────────────────────
  app.get(
    '/intel/velocity/forecast',
    { preHandler: [app.authenticate, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = velocityForecastQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const result = await getVelocityForecast(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /intel/epics/:epic_id/forecast ───────────────────────────────────────
  app.get(
    '/intel/epics/:epic_id/forecast',
    { preHandler: [app.authenticate, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = epicForecastParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid params', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const result = await getEpicCompletionForecast(tenantId, parsed.data);
      if (!result) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'Epic not found or has no entries'));
      }
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /intel/sla/risk ──────────────────────────────────────────────────────
  app.get(
    '/intel/sla/risk',
    { preHandler: [app.authenticate, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = slaRiskQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const result = await getSlaRisk(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /intel/anomalies ─────────────────────────────────────────────────────
  app.get(
    '/intel/anomalies',
    { preHandler: [app.authenticate, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = anomaliesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const result = await getAnomalies(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /intel/recommendations ───────────────────────────────────────────────
  app.get(
    '/intel/recommendations',
    { preHandler: [app.authenticate, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = recommendationsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const result = await getRecommendations(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /intel/capacity ──────────────────────────────────────────────────────
  app.get(
    '/intel/capacity',
    { preHandler: [app.authenticate, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = capacityQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const result = await getCapacity(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );
}
