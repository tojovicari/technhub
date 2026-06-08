import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import {
  insightsCalculationPolicyGetQuerySchema,
  insightsCalculationPolicyHistoryQuerySchema,
  insightsCalculationPolicyPublishBodySchema,
  insightsCalculationPolicyPutBodySchema,
  insightsBacklogQualityQuerySchema,
  insightsIncidentsQuerySchema,
  insightsOverviewQuerySchema,
  insightsPlanningConfidenceQuerySchema,
  insightsRecomputeBodySchema,
  insightsTrendsQuerySchema,
  insightsResourceGroupParamsSchema
} from './schema.js';
import {
  createDraftCalculationPolicy,
  getActiveCalculationPolicyForResourceGroup,
  listCalculationPolicyMappingCandidatesForResourceGroup,
  listCalculationPolicyHistory,
  publishDraftCalculationPolicy
} from './policy.service.js';
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

  app.get('/insights/resource-groups/:group_id/calculation-policy', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.read')]
  }, async (request, reply) => {
    const params = insightsResourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const query = insightsCalculationPolicyGetQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query', { issues: query.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await getActiveCalculationPolicyForResourceGroup(
      tenantId,
      params.data.group_id,
      query.data.at
    );

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.get('/insights/resource-groups/:group_id/calculation-policy/candidates', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.read')]
  }, async (request, reply) => {
    const params = insightsResourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await listCalculationPolicyMappingCandidatesForResourceGroup(
      tenantId,
      params.data.group_id
    );

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.put('/insights/resource-groups/:group_id/calculation-policy', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.write')]
  }, async (request, reply) => {
    const params = insightsResourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const body = insightsCalculationPolicyPutBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid body', { issues: body.error.issues }));
    }

    const user = request.user as { tenant_id: string; sub: string };
    const tenantId = user.tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await createDraftCalculationPolicy({
      tenantId,
      resourceGroupId: params.data.group_id,
      userId: user.sub,
      body: body.data
    });

    if ('error' in result) {
      if (result.error === 'GROUP_NOT_FOUND') {
        return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
      }

      if (result.error === 'OVERLAPPING_STATUS_MAPPING') {
        return reply.status(400).send(
          fail(request, 'BAD_REQUEST', 'Invalid policy config: duplicated status mapping entry')
        );
      }

      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid policy config'));
    }

    return reply.status(201).send(ok(request, result.data));
  });

  app.post('/insights/resource-groups/:group_id/calculation-policy/publish', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.publish')]
  }, async (request, reply) => {
    const params = insightsResourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const body = insightsCalculationPolicyPublishBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid body', { issues: body.error.issues }));
    }

    const user = request.user as { tenant_id: string; sub: string };
    const tenantId = user.tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await publishDraftCalculationPolicy({
      tenantId,
      resourceGroupId: params.data.group_id,
      userId: user.sub,
      body: body.data
    });

    if ('error' in result) {
      if (result.error === 'GROUP_NOT_FOUND' || result.error === 'DRAFT_NOT_FOUND') {
        return reply.status(404).send(fail(request, 'NOT_FOUND', 'Draft policy not found for this resource group'));
      }

      if (result.error === 'INVALID_EFFECTIVE_RANGE') {
        return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid effective range'));
      }

      if (result.error === 'ACTIVE_POLICY_CONFLICT') {
        return reply.status(409).send(
          fail(request, 'CONFLICT', 'Another active policy conflicts with this effective period', {
            conflict_policy_id: result.conflictPolicyId
          })
        );
      }

      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid publish request'));
    }

    return reply.status(200).send(ok(request, result.data));
  });

  app.get('/insights/resource-groups/:group_id/calculation-policy/history', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.read')]
  }, async (request, reply) => {
    const params = insightsResourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const query = insightsCalculationPolicyHistoryQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query', { issues: query.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await listCalculationPolicyHistory({
      tenantId,
      resourceGroupId: params.data.group_id,
      query: query.data
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
    }

    return reply.status(200).send(ok(request, result));
  });
}
