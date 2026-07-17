import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { fail, ok } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import {
  insightsFormulaCreateBodySchema,
  insightsFormulaListQuerySchema,
  insightsClassifierCreateBodySchema,
  insightsClassifierListQuerySchema,
  insightsSquadClassifierParamsSchema,
  insightsScopeCreateBodySchema,
  insightsScopeListQuerySchema,
  insightsSquadScopeParamsSchema,
  insightsFormulaPublishBodySchema,
  insightsFormulaPublishParamsSchema,
  insightsFormulaSimulateBodySchema,
  insightsCalculationPolicyGetQuerySchema,
  insightsCalculationPolicyHistoryQuerySchema,
  insightsCalculationPolicyPublishBodySchema,
  insightsCalculationPolicyPutBodySchema,
  insightsBacklogQualityQuerySchema,
  insightsFieldCatalogQuerySchema,
  insightsIncidentsQuerySchema,
  insightsMaterializedQuerySchema,
  insightsOverviewQuerySchema,
  insightsPlanningConfidenceQuerySchema,
  insightsRecomputeBodySchema,
  insightsSquadInsightParamsSchema,
  insightsSquadParamsSchema,
  insightsSquadRecomputeBodySchema,
  insightsSquadRunParamsSchema,
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
  getObservedFieldCatalog,
  getIncidentInsightsByResourceGroup,
  getInsightsOverviewByResourceGroup,
  getInsightTrendsByResourceGroup,
  getPlanningConfidenceByResourceGroup,
  recomputeInsightsForResourceGroup
} from './service.js';
import {
  createDraftSquadClassifier,
  createDraftSquadScope,
  listSquadClassifiers,
  listSquadScopes,
  publishSquadClassifier,
  publishSquadScope,
} from './squad-classification.service.js';
import {
  createDraftMetricFormula,
  getMaterializedInsightExplainability,
  getMetricComputationRun,
  listMaterializedInsightsForSquad,
  listMetricFormulasForSquad,
  publishMetricFormula,
  recomputeSquadMetrics,
  simulateMetricFormula
} from './metric-formula.service.js';

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

  app.get('/insights/field-catalog', {
    preHandler: [app.authenticate, app.requirePermission('insights.read')]
  }, async (request, reply) => {
    const query = insightsFieldCatalogQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query', { issues: query.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await getObservedFieldCatalog(tenantId, query.data);
    return reply.status(200).send(ok(request, result));
  });

  app.get('/insights/squads/:squad_id/formulas', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.read')]
  }, async (request, reply) => {
    const params = insightsSquadParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const query = insightsFormulaListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query', { issues: query.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await listMetricFormulasForSquad({
      tenantId,
      squadId: params.data.squad_id,
      ...query.data
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Squad not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.get('/insights/squads/:squad_id/scopes', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.read')]
  }, async (request, reply) => {
    const params = insightsSquadParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const query = insightsScopeListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query', { issues: query.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await listSquadScopes({
      tenantId,
      squadId: params.data.squad_id,
      status: query.data.status,
      limit: query.data.limit
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Squad not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.post('/insights/squads/:squad_id/scopes', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.write')]
  }, async (request, reply) => {
    const params = insightsSquadParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const body = insightsScopeCreateBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid body', { issues: body.error.issues }));
    }

    const user = request.user as { tenant_id: string; sub: string };
    const scopeError = ensureTenantScope(request, reply, user.tenant_id);
    if (scopeError) return scopeError;

    const result = await createDraftSquadScope({
      tenantId: user.tenant_id,
      squadId: params.data.squad_id,
      userId: user.sub,
      name: body.data.name,
      config: body.data.config as unknown as Prisma.InputJsonValue
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Squad not found'));
    }

    return reply.status(201).send(ok(request, result));
  });

  app.post('/insights/squads/:squad_id/scopes/:scope_id/publish', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.publish')]
  }, async (request, reply) => {
    const params = insightsSquadScopeParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const user = request.user as { tenant_id: string; sub: string };
    const scopeError = ensureTenantScope(request, reply, user.tenant_id);
    if (scopeError) return scopeError;

    const result = await publishSquadScope({
      tenantId: user.tenant_id,
      squadId: params.data.squad_id,
      scopeId: params.data.scope_id,
      userId: user.sub
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Scope or squad not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.get('/insights/squads/:squad_id/classifiers', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.read')]
  }, async (request, reply) => {
    const params = insightsSquadParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const query = insightsClassifierListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query', { issues: query.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await listSquadClassifiers({
      tenantId,
      squadId: params.data.squad_id,
      status: query.data.status,
      key: query.data.key,
      limit: query.data.limit
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Squad not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.post('/insights/squads/:squad_id/classifiers', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.write')]
  }, async (request, reply) => {
    const params = insightsSquadParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const body = insightsClassifierCreateBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid body', { issues: body.error.issues }));
    }

    const user = request.user as { tenant_id: string; sub: string };
    const scopeError = ensureTenantScope(request, reply, user.tenant_id);
    if (scopeError) return scopeError;

    const result = await createDraftSquadClassifier({
      tenantId: user.tenant_id,
      squadId: params.data.squad_id,
      userId: user.sub,
      key: body.data.key,
      appliesToFactType: body.data.applies_to_fact_type,
      config: body.data.config as unknown as Prisma.InputJsonValue
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Squad not found'));
    }

    return reply.status(201).send(ok(request, result));
  });

  app.post('/insights/squads/:squad_id/classifiers/:classifier_id/publish', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.publish')]
  }, async (request, reply) => {
    const params = insightsSquadClassifierParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const user = request.user as { tenant_id: string; sub: string };
    const scopeError = ensureTenantScope(request, reply, user.tenant_id);
    if (scopeError) return scopeError;

    const result = await publishSquadClassifier({
      tenantId: user.tenant_id,
      squadId: params.data.squad_id,
      classifierId: params.data.classifier_id,
      userId: user.sub
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Classifier or squad not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.post('/insights/squads/:squad_id/formulas', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.write')]
  }, async (request, reply) => {
    const params = insightsSquadParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const body = insightsFormulaCreateBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid body', { issues: body.error.issues }));
    }

    const user = request.user as { tenant_id: string; sub: string };
    const scopeError = ensureTenantScope(request, reply, user.tenant_id);
    if (scopeError) return scopeError;

    const result = await createDraftMetricFormula({
      tenantId: user.tenant_id,
      squadId: params.data.squad_id,
      userId: user.sub,
      key: body.data.key,
      name: body.data.name,
      description: body.data.description,
      unit: body.data.unit,
      windowDays: body.data.window_days,
      config: body.data.config as unknown as Prisma.InputJsonValue
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Squad not found'));
    }

    return reply.status(201).send(ok(request, result));
  });

  app.post('/insights/squads/:squad_id/formulas/:formula_id/publish', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.publish')]
  }, async (request, reply) => {
    const params = insightsFormulaPublishParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const body = insightsFormulaPublishBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid body', { issues: body.error.issues }));
    }

    const user = request.user as { tenant_id: string; sub: string };
    const scopeError = ensureTenantScope(request, reply, user.tenant_id);
    if (scopeError) return scopeError;

    const result = await publishMetricFormula({
      tenantId: user.tenant_id,
      squadId: params.data.squad_id,
      formulaId: params.data.formula_id,
      userId: user.sub
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Formula or squad not found'));
    }

    return reply.status(200).send(ok(request, { ...result, status: body.data.status }));
  });

  app.post('/insights/squads/:squad_id/formulas/simulate', {
    preHandler: [app.authenticate, app.requirePermission('insights.policy.write')]
  }, async (request, reply) => {
    const params = insightsSquadParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const body = insightsFormulaSimulateBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid body', { issues: body.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const now = new Date();
    const windowEnd = body.data.window_end ?? now;
    const windowStart = body.data.window_start ?? new Date(windowEnd.getTime() - body.data.window_days * 24 * 60 * 60 * 1000);

    const result = await simulateMetricFormula({
      tenantId,
      squadId: params.data.squad_id,
      windowStart,
      windowEnd,
      formula: {
        key: body.data.key,
        name: body.data.name,
        unit: body.data.unit,
        version: 1,
        config: body.data.config as any
      }
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Squad not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.get('/insights/squads/:squad_id/materialized', {
    preHandler: [app.authenticate, app.requirePermission('insights.read')]
  }, async (request, reply) => {
    const params = insightsSquadParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const query = insightsMaterializedQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query', { issues: query.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await listMaterializedInsightsForSquad({
      tenantId,
      squadId: params.data.squad_id,
      metricKey: query.data.metric_key,
      windowStart: query.data.window_start,
      windowEnd: query.data.window_end,
      limit: query.data.limit
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Squad not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.get('/insights/squads/:squad_id/materialized/:insight_id/explainability', {
    preHandler: [app.authenticate, app.requirePermission('insights.read')]
  }, async (request, reply) => {
    const params = insightsSquadInsightParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await getMaterializedInsightExplainability({
      tenantId,
      squadId: params.data.squad_id,
      insightId: params.data.insight_id
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Materialized insight not found'));
    }

    return reply.status(200).send(ok(request, result));
  });

  app.post('/insights/squads/:squad_id/recompute', {
    preHandler: [app.authenticate, app.requirePermission('insights.recompute')]
  }, async (request, reply) => {
    const params = insightsSquadParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const body = insightsSquadRecomputeBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid body', { issues: body.error.issues }));
    }

    const user = request.user as { tenant_id: string; sub: string };
    const scopeError = ensureTenantScope(request, reply, user.tenant_id);
    if (scopeError) return scopeError;

    const result = await recomputeSquadMetrics({
      tenantId: user.tenant_id,
      squadId: params.data.squad_id,
      windowDays: body.data.window_days,
      triggerReason: body.data.reason,
      triggeredBy: user.sub
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Squad not found'));
    }

    return reply.status(202).send(ok(request, result));
  });

  app.get('/insights/squads/:squad_id/recompute/:run_id', {
    preHandler: [app.authenticate, app.requirePermission('insights.read')]
  }, async (request, reply) => {
    const params = insightsSquadRunParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid params', { issues: params.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const scopeError = ensureTenantScope(request, reply, tenantId);
    if (scopeError) return scopeError;

    const result = await getMetricComputationRun({
      tenantId,
      squadId: params.data.squad_id,
      runId: params.data.run_id
    });

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Computation run not found'));
    }

    return reply.status(200).send(ok(request, result));
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
