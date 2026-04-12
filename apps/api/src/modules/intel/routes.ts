import type { FastifyInstance } from 'fastify';
import { ok, fail } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import {
  velocityForecastQuerySchema,
  epicForecastParamsSchema,
  slaRiskQuerySchema,
  anomaliesQuerySchema,
  recommendationsQuerySchema,
  capacityQuerySchema,
  roadmapQuerySchema,
  dependencyQuerySchema,
  exportQuerySchema
} from './schema.js';
import {
  getVelocityForecast,
  getEpicCompletionForecast,
  getSlaRisk,
  getAnomalies,
  getRecommendations,
  getCapacity,
  getRoadmap,
  getDependencies,
  getExport
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

  // ── GET /intel/roadmap ───────────────────────────────────────────────────────
  app.get(
    '/intel/roadmap',
    { preHandler: [app.authenticate, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = roadmapQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const result = await getRoadmap(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /intel/dependencies ──────────────────────────────────────────────────
  app.get(
    '/intel/dependencies',
    { preHandler: [app.authenticate, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = dependencyQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const result = await getDependencies(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /intel/export ────────────────────────────────────────────────────────
  app.get(
    '/intel/export',
    { preHandler: [app.authenticate, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = exportQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      try {
        const csv = await getExport(tenantId, parsed.data);
        const filename = `cto-ai-${parsed.data.type}-${new Date().toISOString().split('T')[0]}.csv`;
        return reply
          .status(200)
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(csv);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Export failed';
        return reply.status(400).send(fail(req, 'BAD_REQUEST', message));
      }
    }
  );
}
