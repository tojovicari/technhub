import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import {
  insightsBacklogQualityQuerySchema,
  insightsIncidentsQuerySchema,
  insightsOverviewQuerySchema,
  insightsPlanningConfidenceQuerySchema,
  insightsRecomputeBodySchema,
  insightsTrendsQuerySchema,
  insightsResourceGroupParamsSchema
} from './schema.js';
import {
  getBacklogQualityByResourceGroup,
  getIncidentInsightsByResourceGroup,
  getInsightsOverviewByResourceGroup,
  getInsightTrendsByResourceGroup,
  getPlanningConfidenceByResourceGroup,
  recomputeInsightsForResourceGroup
} from './service.js';

export async function insightsRoutes(app: FastifyInstance) {
  app.get('/insights/resource-groups/:group_id/overview', {
    preHandler: [app.authenticate, app.requirePermission('insights.read')]
  }, async (request, reply) => {
    const params = insightsResourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const query = insightsOverviewQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query', { issues: query.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await getInsightsOverviewByResourceGroup(tenantId, params.data.group_id, query.data);
    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.get('/insights/resource-groups/:group_id/incidents', {
    preHandler: [app.authenticate, app.requirePermission('insights.read')]
  }, async (request, reply) => {
    const params = insightsResourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const query = insightsIncidentsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query', { issues: query.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await getIncidentInsightsByResourceGroup(tenantId, params.data.group_id, query.data);
    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.get('/insights/resource-groups/:group_id/planning-confidence', {
    preHandler: [app.authenticate, app.requirePermission('insights.read')]
  }, async (request, reply) => {
    const params = insightsResourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const query = insightsPlanningConfidenceQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query', { issues: query.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await getPlanningConfidenceByResourceGroup(tenantId, params.data.group_id, query.data);
    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.get('/insights/resource-groups/:group_id/backlog-quality', {
    preHandler: [app.authenticate, app.requirePermission('insights.read')]
  }, async (request, reply) => {
    const params = insightsResourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const query = insightsBacklogQualityQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query', { issues: query.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await getBacklogQualityByResourceGroup(tenantId, params.data.group_id, query.data);
    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.get('/insights/resource-groups/:group_id/trends', {
    preHandler: [app.authenticate, app.requirePermission('insights.read')]
  }, async (request, reply) => {
    const params = insightsResourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const query = insightsTrendsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query', { issues: query.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await getInsightTrendsByResourceGroup(tenantId, params.data.group_id, query.data);
    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.post('/insights/resource-groups/:group_id/recompute', {
    preHandler: [app.authenticate, app.requirePermission('insights.recompute')]
  }, async (request, reply) => {
    const params = insightsResourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const body = insightsRecomputeBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid body', { issues: body.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await recomputeInsightsForResourceGroup(tenantId, params.data.group_id, body.data);
    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
    }

    if ('error' in result && result.error === 'JOB_IN_PROGRESS') {
      return reply.status(409).send(fail(request, 'CONFLICT', 'Recompute already in progress for this resource group'));
    }

    return reply.status(202).send(ok(request, result));
  });
}
