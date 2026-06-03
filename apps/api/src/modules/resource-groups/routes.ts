import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { logResourceGroupAudit } from '../../lib/audit.js';
import {
  addResourceGroupResourceBodySchema,
  addResourceGroupTeamBodySchema,
  createResourceGroupBodySchema,
  listResourceGroupsQuerySchema,
  resourceGroupParamsSchema,
  resourceGroupResourceParamsSchema,
  resourceGroupTeamParamsSchema,
  updateResourceGroupBodySchema
} from './schema.js';
import {
  addResourceToGroup,
  addTeamToGroup,
  createResourceGroup,
  getResourceGroup,
  getResourceGroupMetricsSummary,
  listResourceGroups,
  removeResourceFromGroup,
  removeTeamFromGroup,
  updateResourceGroup
} from './service.js';

function mapResourceGroup(group: any) {
  return {
    id: group.id,
    tenant_id: group.tenantId,
    key: group.key,
    name: group.name,
    description: group.description,
    status: group.status,
    owner_user_id: group.ownerUserId ?? null,
    tags: group.tags,
    created_at: group.createdAt.toISOString(),
    updated_at: group.updatedAt.toISOString(),
    resources_count: group._count?.resources,
    teams_count: group._count?.teams,
    resources: group.resources
      ? group.resources.map((link: any) => ({
          resource_group_id: link.resourceGroupId,
          project_id: link.projectId,
          role: link.role,
          weight_mode: link.weightMode,
          manual_weight: link.manualWeight,
          created_at: link.createdAt.toISOString(),
          project: {
            id: link.project.id,
            key: link.project.key,
            name: link.project.name,
            status: link.project.status,
            team_id: link.project.teamId,
            sources: link.project.sources?.map((s: any) => ({
              id: s.id,
              provider: s.provider,
              external_id: s.externalId,
              display_name: s.displayName
            })) ?? []
          }
        }))
      : undefined,
    teams: group.teams
      ? group.teams.map((link: any) => ({
          resource_group_id: link.resourceGroupId,
          team_id: link.teamId,
          role: link.role,
          allocation_percent: link.allocationPercent,
          created_at: link.createdAt.toISOString(),
          team: {
            id: link.team.id,
            name: link.team.name,
            lead_id: link.team.leadId,
            tags: link.team.tags
          }
        }))
      : undefined
  };
}

export async function resourceGroupsRoutes(app: FastifyInstance) {
  app.post('/resource-groups', {
    preHandler: [app.authenticate, app.requirePermission('resource_group.manage')]
  }, async (request, reply) => {
    const parsed = createResourceGroupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const created = await createResourceGroup(tenantId, parsed.data);

    logResourceGroupAudit(request, 'resource_group.create', {
      resource_group_id: created.id,
      key: created.key,
      status: created.status
    });

    return reply.status(201).send(ok(request, mapResourceGroup(created)));
  });

  app.get('/resource-groups', {
    preHandler: [app.authenticate, app.requirePermission('resource_group.read')]
  }, async (request, reply) => {
    const parsed = listResourceGroupsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query parameters', { issues: parsed.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const { items, nextCursor } = await listResourceGroups(tenantId, parsed.data);
    return reply.status(200).send(ok(request, { items: items.map(mapResourceGroup), next_cursor: nextCursor }));
  });

  app.get('/resource-groups/:group_id', {
    preHandler: [app.authenticate, app.requirePermission('resource_group.read')]
  }, async (request, reply) => {
    const params = resourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid group_id'));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const group = await getResourceGroup(tenantId, params.data.group_id);
    if (!group) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
    }

    return reply.status(200).send(ok(request, mapResourceGroup(group)));
  });

  app.patch('/resource-groups/:group_id', {
    preHandler: [app.authenticate, app.requirePermission('resource_group.manage')]
  }, async (request, reply) => {
    const params = resourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid group_id'));
    }

    const parsed = updateResourceGroupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const updated = await updateResourceGroup(tenantId, params.data.group_id, parsed.data);
    if (!updated) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
    }

    logResourceGroupAudit(request, 'resource_group.update', {
      resource_group_id: updated.id,
      updated_fields: Object.keys(parsed.data)
    });

    return reply.status(200).send(ok(request, mapResourceGroup(updated)));
  });

  app.post('/resource-groups/:group_id/resources', {
    preHandler: [app.authenticate, app.requirePermission('resource_group.manage')]
  }, async (request, reply) => {
    const params = resourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid group_id'));
    }

    const parsed = addResourceGroupResourceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const result = await addResourceToGroup(tenantId, params.data.group_id, parsed.data);

    if ('error' in result) {
      if (result.error === 'GROUP_NOT_FOUND') {
        return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
      }
      if (result.error === 'PROJECT_NOT_FOUND') {
        return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource not found'));
      }
    }

    logResourceGroupAudit(request, 'resource_group.resource.upsert', {
      resource_group_id: result.data.resourceGroupId,
      project_id: result.data.projectId,
      role: result.data.role,
      weight_mode: result.data.weightMode
    });

    return reply.status(200).send(ok(request, {
      resource_group_id: result.data.resourceGroupId,
      project_id: result.data.projectId,
      role: result.data.role,
      weight_mode: result.data.weightMode,
      manual_weight: result.data.manualWeight,
      created_at: result.data.createdAt.toISOString()
    }));
  });

  app.delete('/resource-groups/:group_id/resources/:project_id', {
    preHandler: [app.authenticate, app.requirePermission('resource_group.manage')]
  }, async (request, reply) => {
    const params = resourceGroupResourceParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid path params'));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const removed = await removeResourceFromGroup(tenantId, params.data.group_id, params.data.project_id);
    if (!removed) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource link not found'));
    }

    logResourceGroupAudit(request, 'resource_group.resource.remove', {
      resource_group_id: params.data.group_id,
      project_id: params.data.project_id
    });

    return reply.status(204).send();
  });

  app.post('/resource-groups/:group_id/teams', {
    preHandler: [app.authenticate, app.requirePermission('resource_group.manage')]
  }, async (request, reply) => {
    const params = resourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid group_id'));
    }

    const parsed = addResourceGroupTeamBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const result = await addTeamToGroup(tenantId, params.data.group_id, parsed.data);

    if ('error' in result) {
      if (result.error === 'GROUP_NOT_FOUND') {
        return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
      }
      if (result.error === 'TEAM_NOT_FOUND') {
        return reply.status(404).send(fail(request, 'NOT_FOUND', 'Team not found'));
      }
    }

    logResourceGroupAudit(request, 'resource_group.team.upsert', {
      resource_group_id: result.data.resourceGroupId,
      team_id: result.data.teamId,
      role: result.data.role,
      allocation_percent: result.data.allocationPercent
    });

    return reply.status(200).send(ok(request, {
      resource_group_id: result.data.resourceGroupId,
      team_id: result.data.teamId,
      role: result.data.role,
      allocation_percent: result.data.allocationPercent,
      created_at: result.data.createdAt.toISOString()
    }));
  });

  app.delete('/resource-groups/:group_id/teams/:team_id', {
    preHandler: [app.authenticate, app.requirePermission('resource_group.manage')]
  }, async (request, reply) => {
    const params = resourceGroupTeamParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid path params'));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const removed = await removeTeamFromGroup(tenantId, params.data.group_id, params.data.team_id);
    if (!removed) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Team link not found'));
    }

    logResourceGroupAudit(request, 'resource_group.team.remove', {
      resource_group_id: params.data.group_id,
      team_id: params.data.team_id
    });

    return reply.status(204).send();
  });

  app.get('/resource-groups/:group_id/metrics/summary', {
    preHandler: [app.authenticate, app.requirePermission('resource_group.metrics.read')]
  }, async (request, reply) => {
    const params = resourceGroupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid group_id'));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const summary = await getResourceGroupMetricsSummary(tenantId, params.data.group_id);
    if (!summary) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Resource group not found'));
    }

    return reply.status(200).send(ok(request, summary));
  });
}
