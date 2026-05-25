import type { FastifyInstance } from 'fastify';
import { ok, fail } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import { requireModule } from '../billing/entitlement.js';
import {
  velocityForecastQuerySchema,
  epicForecastParamsSchema,
  slaRiskQuerySchema,
  anomaliesQuerySchema,
  recommendationsQuerySchema,
  capacityQuerySchema,
  roadmapQuerySchema,
  dependencyQuerySchema,
  exportQuerySchema,
  onTimeDeliveryQuerySchema,
  workMixQuerySchema,
  reworkRateQuerySchema,
  estimationAccuracyQuerySchema,
  keyPersonRiskQuerySchema,
  teamHealthQuerySchema,
  incidentPatternsQuerySchema,
  deployQualityQuerySchema,
  slaSuggestionsQuerySchema,
  trendDegradationQuerySchema
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
  getExport,
  getOnTimeDelivery,
  getWorkMix,
  getReworkRate,
  getEstimationAccuracy,
  getKeyPersonRisk,
  getTeamHealth,
  getIncidentPatterns,
  getDeployQuality,
  getSlaSuggestions,
  getTrendDegradation
} from './service.js';

export async function intelRoutes(app: FastifyInstance) {
  const intelGuard = requireModule('intel');
  
  // ── GET /intel/velocity/forecast ─────────────────────────────────────────────
  app.get(
    '/intel/velocity/forecast',
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
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
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
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
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
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
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
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
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
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
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
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
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
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
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
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
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
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

  // ── v2.1: On-time delivery ─────────────────────────────────────────────────

  app.get(
    '/intel/on-time-delivery',
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = onTimeDeliveryQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;
      const result = await getOnTimeDelivery(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── v2.2: Work mix ─────────────────────────────────────────────────────────

  app.get(
    '/intel/work-mix',
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = workMixQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;
      const result = await getWorkMix(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── v2.3: Rework rate ──────────────────────────────────────────────────────

  app.get(
    '/intel/rework-rate',
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = reworkRateQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;
      const result = await getReworkRate(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── v2.4: Estimation accuracy ──────────────────────────────────────────────

  app.get(
    '/intel/estimation-accuracy',
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = estimationAccuracyQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;
      const result = await getEstimationAccuracy(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── v2.5: Key person risk ──────────────────────────────────────────────────

  app.get(
    '/intel/key-person-risk',
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = keyPersonRiskQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;
      const result = await getKeyPersonRisk(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── v2.6: Team health ──────────────────────────────────────────────────────

  app.get(
    '/intel/team-health',
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = teamHealthQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;
      const result = await getTeamHealth(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── v2.7: Incident patterns ────────────────────────────────────────────────

  app.get(
    '/intel/incident-patterns',
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = incidentPatternsQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;
      const result = await getIncidentPatterns(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── v2.8: Deploy quality ───────────────────────────────────────────────────

  app.get(
    '/intel/deploy-quality',
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = deployQualityQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;
      const result = await getDeployQuality(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── v2.9: SLA suggestions ──────────────────────────────────────────────────

  app.get(
    '/intel/sla-suggestions',
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = slaSuggestionsQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;
      const result = await getSlaSuggestions(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── v2.10: Trend degradation ───────────────────────────────────────────────

  app.get(
    '/intel/trend-degradation',
    { preHandler: [app.authenticate, intelGuard, app.requirePermission('intel.read')] },
    async (req, reply) => {
      const parsed = trendDegradationQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;
      const result = await getTrendDegradation(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );
}
