import type { FastifyInstance } from 'fastify';
import { ok, fail } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import {
  ingestDeployEvent,
  computeDoraScorecard,
  listDeployEvents,
  ingestLeadTimeEvent,
  listHealthMetrics
} from './service.js';
import {
  ingestDeployEventSchema,
  doraQuerySchema,
  listDeployEventsQuerySchema,
  ingestLeadTimeEventSchema
} from './schema.js';
import { z } from 'zod';

const metricHistoryQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  window_days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional()
});

export async function doraRoutes(app: FastifyInstance) {
  // POST /dora/deploys — ingest a deployment event
  app.post(
    '/dora/deploys',
    { preHandler: [app.authenticate, app.requirePermission('dora.deploy.ingest')] },
    async (req, reply) => {
      const result = ingestDeployEventSchema.safeParse(req.body);
      if (!result.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid body', { issues: result.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const event = await ingestDeployEvent(tenantId, result.data);
      return reply.status(201).send(ok(req, event));
    }
  );

  // GET /dora/deploys — list deploy events
  app.get(
    '/dora/deploys',
    { preHandler: [app.authenticate, app.requirePermission('dora.read')] },
    async (req, reply) => {
      const result = listDeployEventsQuerySchema.safeParse(req.query);
      if (!result.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: result.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const list = await listDeployEvents(tenantId, result.data);
      return reply.status(200).send(ok(req, list));
    }
  );

  // GET /dora/scorecard — compute DORA scorecard for a window
  app.get(
    '/dora/scorecard',
    { preHandler: [app.authenticate, app.requirePermission('dora.read')] },
    async (req, reply) => {
      const result = doraQuerySchema.safeParse(req.query);
      if (!result.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: result.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const scorecard = await computeDoraScorecard(tenantId, result.data);
      return reply.status(200).send(ok(req, scorecard));
    }
  );

  // POST /dora/lead-time — ingest lead time from a merged PR
  app.post(
    '/dora/lead-time',
    { preHandler: [app.authenticate, app.requirePermission('dora.deploy.ingest')] },
    async (req, reply) => {
      const result = ingestLeadTimeEventSchema.safeParse(req.body);
      if (!result.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid body', { issues: result.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const outcome = await ingestLeadTimeEvent(tenantId, result.data);
      return reply.status(201).send(ok(req, outcome));
    }
  );

  // GET /dora/history/:metric_name — historical snapshots for a metric
  app.get(
    '/dora/history/:metric_name',
    { preHandler: [app.authenticate, app.requirePermission('dora.read')] },
    async (req, reply) => {
      const { metric_name } = req.params as { metric_name: string };
      const result = metricHistoryQuerySchema.safeParse(req.query);
      if (!result.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: result.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const history = await listHealthMetrics(tenantId, {
        metric_name,
        project_id: result.data.project_id,
        window_days: result.data.window_days,
        limit: result.data.limit,
        cursor: result.data.cursor
      });
      return reply.status(200).send(ok(req, history));
    }
  );
}
