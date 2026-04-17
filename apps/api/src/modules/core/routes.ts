import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import {
  addProjectSourceSchema,
  addTaskDependencySchema,
  addTeamMemberSchema,
  createEpicSchema,
  createProjectSchema,
  createTaskSchema,
  createTeamSchema,
  createUserSchema,
  listQuerySchema,
  updateProjectSchema,
  updateTaskSchema,
  updateTeamSchema
} from './schema.js';
import {
  addProjectSource,
  addTaskDependency,
  addTeamMember,
  createEpic,
  createProject,
  createTask,
  createTeam,
  getEpic,
  getProject,
  getTask,
  listEpics,
  listProjectSources,
  listProjects,
  listTaskDependencies,
  listTasks,
  listTeamMembers,
  listTeams,
  listUsers,
  removeProjectSource,
  removeTaskDependency,
  removeTeamMember,
  updateProject,
  updateTask,
  updateTeam,
  upsertUser,
  getCoreSummary
} from './service.js';

function mapTeam(team: { id: string; tenantId: string; name: string; description: string | null; leadId: string | null; budgetQuarterly: number | null; hourlyRate: number | null; tags: string[] }) {
  return {
    id: team.id,
    tenant_id: team.tenantId,
    name: team.name,
    description: team.description,
    lead_id: team.leadId,
    budget_quarterly: team.budgetQuarterly,
    hourly_rate: team.hourlyRate,
    tags: team.tags
  };
}

function mapProjectSource(source: { id: string; tenantId: string; projectId: string; provider: string; externalId: string; displayName: string | null; createdAt: Date }) {
  return {
    id: source.id,
    tenant_id: source.tenantId,
    project_id: source.projectId,
    provider: source.provider,
    external_id: source.externalId,
    display_name: source.displayName,
    created_at: source.createdAt.toISOString()
  };
}

function mapProject(project: any) {
  return {
    id: project.id,
    tenant_id: project.tenantId,
    key: project.key,
    name: project.name,
    is_initiative: project.isInitiative,
    team_id: project.teamId,
    status: project.status,
    start_date: project.startDate?.toISOString() ?? null,
    target_end_date: project.targetEndDate?.toISOString() ?? null,
    sync_config: project.syncConfig ?? null,
    custom_fields: project.customFields ?? null,
    tags: project.tags,
    team: project.team ? mapTeam(project.team) : null,
    sources: project.sources ? project.sources.map(mapProjectSource) : undefined,
    epic_count: project.epics?.length,
    task_count: project.tasks?.length
  };
}

function mapEpic(epic: any) {
  return {
    id: epic.id,
    tenant_id: epic.tenantId,
    project_id: epic.projectId,
    source: epic.source,
    source_id: epic.sourceId,
    name: epic.name,
    description: epic.description,
    goal: epic.goal,
    status: epic.status,
    owner_id: epic.ownerId,
    total_tasks: epic.totalTasks,
    completed_tasks: epic.completedTasks,
    total_story_points: epic.totalStoryPoints,
    actual_hours: epic.actualHours,
    health_score: epic.healthScore,
    start_date: epic.startDate?.toISOString() ?? null,
    target_end_date: epic.targetEndDate?.toISOString() ?? null,
    actual_end_date: epic.actualEndDate?.toISOString() ?? null
  };
}

function mapTask(task: any) {
  return {
    id: task.id,
    tenant_id: task.tenantId,
    source: task.source,
    source_id: task.sourceId,
    project_id: task.projectId,
    project: task.project
      ? { id: task.project.id, name: task.project.name, key: task.project.key }
      : null,
    epic_id: task.epicId,
    title: task.title,
    description: task.description,
    task_type: task.taskType,
    priority: task.priority,
    status: task.status,
    assignee_id: task.assigneeId,
    reporter_id: task.reporterId,
    story_points: task.storyPoints,
    hours_estimated: task.hoursEstimated,
    hours_actual: task.hoursActual,
    started_at: task.startedAt?.toISOString() ?? null,
    completed_at: task.completedAt?.toISOString() ?? null,
    due_date: task.dueDate?.toISOString() ?? null,
    cycle_time_hours: task.cycleTimeHours,
    related_pr_ids: task.relatedPrIds,
    tags: task.tags,
    custom_fields: task.customFields ?? null
  };
}

function mapUser(user: { id: string; tenantId: string; email: string; fullName: string; role: string; isActive: boolean; hourlyRate: number | null; createdAt: Date; platformAccount?: { id: string } | null }) {
  return {
    id: user.id,
    tenant_id: user.tenantId,
    email: user.email,
    full_name: user.fullName,
    role: user.role,
    is_active: user.isActive,
    hourly_rate: user.hourlyRate,
    has_account: user.platformAccount != null,
    account_id: user.platformAccount?.id ?? null,
    created_at: user.createdAt.toISOString()
  };
}

function mapTeamMember(member: { id: string; teamId: string; userId: string; tenantId: string; createdAt: Date; user: { id: string; tenantId: string; email: string; fullName: string; role: string; isActive: boolean; hourlyRate: number | null; createdAt: Date } }) {
  return {
    id: member.id,
    team_id: member.teamId,
    user_id: member.userId,
    tenant_id: member.tenantId,
    joined_at: member.createdAt.toISOString(),
    user: mapUser(member.user)
  };
}

export async function coreRoutes(app: FastifyInstance) {
  app.post('/core/teams', {
    preHandler: [app.authenticate, app.requirePermission('core.team.manage')]
  }, async (request, reply) => {
    const parsed = createTeamSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const tenantScopeError = ensureTenantScope(request, reply, parsed.data.tenant_id);
    if (tenantScopeError) {
      return tenantScopeError;
    }

    const team = await createTeam(parsed.data);
    return reply.status(201).send(ok(request, mapTeam(team)));
  });

  app.patch('/core/teams/:team_id', {
    preHandler: [app.authenticate, app.requirePermission('core.team.manage')]
  }, async (request, reply) => {
    const parsed = updateTeamSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const { team_id: teamId } = request.params as { team_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const team = await updateTeam(teamId, tenantId, parsed.data);

    if (!team) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Team not found'));
    }

    return reply.status(200).send(ok(request, mapTeam(team)));
  });

  app.get('/core/teams', {
    preHandler: [app.authenticate, app.requirePermission('core.team.read')]
  }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query parameters', { issues: parsed.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const { items, nextCursor } = await listTeams(tenantId, parsed.data);
    return reply.status(200).send(ok(request, { items: items.map(mapTeam), next_cursor: nextCursor }));
  });

  app.post('/core/projects', {
    preHandler: [app.authenticate, app.requirePermission('core.project.manage')]
  }, async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const tenantScopeError = ensureTenantScope(request, reply, parsed.data.tenant_id);
    if (tenantScopeError) {
      return tenantScopeError;
    }

    const project = await createProject(parsed.data);
    return reply.status(201).send(ok(request, mapProject(project)));
  });

  app.patch('/core/projects/:project_id', {
    preHandler: [app.authenticate, app.requirePermission('core.project.manage')]
  }, async (request, reply) => {
    const parsed = updateProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const { project_id: projectId } = request.params as { project_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const project = await updateProject(projectId, tenantId, parsed.data);

    if (!project) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Project not found'));
    }

    return reply.status(200).send(ok(request, mapProject(project)));
  });

  app.get('/core/projects/:project_id', {
    preHandler: [app.authenticate, app.requirePermission('core.project.read')]
  }, async (request, reply) => {
    const { project_id: projectId } = request.params as { project_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const project = await getProject(projectId, tenantId);

    if (!project) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Project not found'));
    }

    return reply.status(200).send(ok(request, mapProject(project)));
  });

  // ─── Project sources ─────────────────────────────────────────────────────────

  app.get('/core/projects/:project_id/sources', {
    preHandler: [app.authenticate, app.requirePermission('core.project.read')]
  }, async (request, reply) => {
    const { project_id: projectId } = request.params as { project_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const sources = await listProjectSources(projectId, tenantId);

    if (!sources) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Project not found'));
    }

    return reply.status(200).send(ok(request, { items: sources.map(mapProjectSource) }));
  });

  app.post('/core/projects/:project_id/sources', {
    preHandler: [app.authenticate, app.requirePermission('core.project.manage')]
  }, async (request, reply) => {
    const parsed = addProjectSourceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const { project_id: projectId } = request.params as { project_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const source = await addProjectSource(projectId, tenantId, parsed.data);

    if (!source) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Project not found'));
    }

    return reply.status(201).send(ok(request, mapProjectSource(source)));
  });

  app.delete('/core/projects/:project_id/sources/:source_id', {
    preHandler: [app.authenticate, app.requirePermission('core.project.manage')]
  }, async (request, reply) => {
    const { project_id: projectId, source_id: sourceId } = request.params as { project_id: string; source_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const result = await removeProjectSource(projectId, sourceId, tenantId);

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Source not found'));
    }

    return reply.status(204).send();
  });

  app.post('/core/epics', {
    preHandler: [app.authenticate, app.requirePermission('core.epic.manage')]
  }, async (request, reply) => {
    const parsed = createEpicSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const tenantScopeError = ensureTenantScope(request, reply, parsed.data.tenant_id);
    if (tenantScopeError) {
      return tenantScopeError;
    }

    const epic = await createEpic(parsed.data);
    return reply.status(201).send(ok(request, mapEpic(epic)));
  });

  app.get('/core/epics/:epic_id', {
    preHandler: [app.authenticate, app.requirePermission('core.epic.read')]
  }, async (request, reply) => {
    const { epic_id: epicId } = request.params as { epic_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const epic = await getEpic(epicId, tenantId);

    if (!epic) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Epic not found'));
    }

    return reply.status(200).send(ok(request, mapEpic(epic)));
  });

  app.post('/core/tasks', {
    preHandler: [app.authenticate, app.requirePermission('core.task.write')]
  }, async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const tenantScopeError = ensureTenantScope(request, reply, parsed.data.tenant_id);
    if (tenantScopeError) {
      return tenantScopeError;
    }

    const task = await createTask(parsed.data);
    return reply.status(201).send(ok(request, mapTask(task)));
  });

  app.patch('/core/tasks/:task_id', {
    preHandler: [app.authenticate, app.requirePermission('core.task.write')]
  }, async (request, reply) => {
    const parsed = updateTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const { task_id: taskId } = request.params as { task_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const task = await updateTask(taskId, tenantId, parsed.data);

    if (!task) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Task not found'));
    }

    return reply.status(200).send(ok(request, mapTask(task)));
  });

  app.get('/core/tasks/:task_id', {
    preHandler: [app.authenticate, app.requirePermission('core.task.read')]
  }, async (request, reply) => {
    const { task_id: taskId } = request.params as { task_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const task = await getTask(taskId, tenantId);

    if (!task) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Task not found'));
    }

    return reply.status(200).send(ok(request, mapTask(task)));
  });

  // ─── Users ─────────────────────────────────────────────────────────────────

  app.post('/core/users', {
    preHandler: [app.authenticate, app.requirePermission('core.user.manage')]
  }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const tenantScopeError = ensureTenantScope(request, reply, parsed.data.tenant_id);
    if (tenantScopeError) {
      return tenantScopeError;
    }

    const user = await upsertUser(parsed.data);
    return reply.status(201).send(ok(request, mapUser(user)));
  });

  app.get('/core/users', {
    preHandler: [app.authenticate, app.requirePermission('core.user.read')]
  }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query parameters', { issues: parsed.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const { items, nextCursor } = await listUsers(tenantId, parsed.data.limit, parsed.data.cursor);
    return reply.status(200).send(ok(request, { items: items.map(mapUser), next_cursor: nextCursor }));
  });

  // ─── Team members ───────────────────────────────────────────────────────────

  app.get('/core/teams/:team_id/members', {
    preHandler: [app.authenticate, app.requirePermission('core.team.read')]
  }, async (request, reply) => {
    const { team_id: teamId } = request.params as { team_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const members = await listTeamMembers(teamId, tenantId);

    if (!members) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Team not found'));
    }

    return reply.status(200).send(ok(request, { items: members.map(mapTeamMember) }));
  });

  app.post('/core/teams/:team_id/members', {
    preHandler: [app.authenticate, app.requirePermission('core.team.manage')]
  }, async (request, reply) => {
    const parsed = addTeamMemberSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const { team_id: teamId } = request.params as { team_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const member = await addTeamMember(teamId, tenantId, parsed.data);

    if (!member) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Team or user not found'));
    }

    return reply.status(201).send(ok(request, { team_id: teamId, user_id: parsed.data.user_id }));
  });

  app.delete('/core/teams/:team_id/members/:user_id', {
    preHandler: [app.authenticate, app.requirePermission('core.team.manage')]
  }, async (request, reply) => {
    const { team_id: teamId, user_id: userId } = request.params as { team_id: string; user_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const result = await removeTeamMember(teamId, userId, tenantId);

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Member not found'));
    }

    return reply.status(204).send();
  });

  // ─── List endpoints ─────────────────────────────────────────────────────────

  app.get('/core/projects', {
    preHandler: [app.authenticate, app.requirePermission('core.project.read')]
  }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query parameters', { issues: parsed.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const { items, nextCursor } = await listProjects(tenantId, parsed.data);
    return reply.status(200).send(ok(request, { items: items.map(mapProject), next_cursor: nextCursor }));
  });

  app.get('/core/epics', {
    preHandler: [app.authenticate, app.requirePermission('core.epic.read')]
  }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query parameters', { issues: parsed.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const { items, nextCursor } = await listEpics(tenantId, parsed.data);
    return reply.status(200).send(ok(request, { items: items.map(mapEpic), next_cursor: nextCursor }));
  });

  app.get('/core/tasks', {
    preHandler: [app.authenticate, app.requirePermission('core.task.read')]
  }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query parameters', { issues: parsed.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const { items, nextCursor } = await listTasks(tenantId, parsed.data);
    return reply.status(200).send(ok(request, { items: items.map(mapTask), next_cursor: nextCursor }));
  });

  app.get('/core/summary', {
    preHandler: [app.authenticate, app.requirePermission('core.task.read')]
  }, async (request, reply) => {
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const summary = await getCoreSummary(tenantId);
    return reply.status(200).send(ok(request, summary));
  });

  // ── Task dependencies ─────────────────────────────────────────────────────────

  app.get('/core/tasks/:task_id/dependencies', {
    preHandler: [app.authenticate, app.requirePermission('core.task.read')]
  }, async (request, reply) => {
    const { task_id: taskId } = request.params as { task_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;

    const result = await listTaskDependencies(tenantId, taskId);
    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Task not found'));
    }
    return reply.status(200).send(ok(request, result));
  });

  app.post('/core/tasks/:task_id/dependencies', {
    preHandler: [app.authenticate, app.requirePermission('core.task.manage')]
  }, async (request, reply) => {
    const parsed = addTaskDependencySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const { task_id: blockerId } = request.params as { task_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const result = await addTaskDependency(tenantId, blockerId, parsed.data.blocked_id);

    if ('error' in result) {
      if (result.error === 'SELF_LOOP') {
        return reply.status(400).send(fail(request, 'BAD_REQUEST', 'A task cannot depend on itself'));
      }
      if (result.error === 'BLOCKER_NOT_FOUND') {
        return reply.status(404).send(fail(request, 'NOT_FOUND', 'Blocker task not found'));
      }
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Blocked task not found'));
    }

    return reply.status(201).send(ok(request, {
      blocker_id: blockerId,
      blocked_id: parsed.data.blocked_id
    }));
  });

  app.delete('/core/tasks/:task_id/dependencies/:blocked_id', {
    preHandler: [app.authenticate, app.requirePermission('core.task.manage')]
  }, async (request, reply) => {
    const { task_id: blockerId, blocked_id: blockedId } = request.params as { task_id: string; blocked_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;

    const deleted = await removeTaskDependency(tenantId, blockerId, blockedId);
    if (!deleted) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Dependency not found'));
    }
    return reply.status(204).send();
  });
}
