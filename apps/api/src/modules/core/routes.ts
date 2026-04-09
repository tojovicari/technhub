import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import {
  addTeamMemberSchema,
  createEpicSchema,
  createProjectSchema,
  createTaskSchema,
  createTeamSchema,
  createUserSchema,
  listQuerySchema,
  updateTaskSchema
} from './schema.js';
import {
  addTeamMember,
  createEpic,
  createProject,
  createTask,
  createTeam,
  getEpic,
  getProject,
  getTask,
  listEpics,
  listProjects,
  listTasks,
  listTeamMembers,
  listUsers,
  removeTeamMember,
  updateTask,
  upsertUser
} from './service.js';

function mapTeam(team: { id: string; tenantId: string; name: string; description: string | null; leadId: string | null; budgetQuarterly: number | null; tags: string[] }) {
  return {
    id: team.id,
    tenant_id: team.tenantId,
    name: team.name,
    description: team.description,
    lead_id: team.leadId,
    budget_quarterly: team.budgetQuarterly,
    tags: team.tags
  };
}

function mapProject(project: any) {
  return {
    id: project.id,
    tenant_id: project.tenantId,
    key: project.key,
    name: project.name,
    team_id: project.teamId,
    status: project.status,
    start_date: project.startDate?.toISOString() ?? null,
    target_end_date: project.targetEndDate?.toISOString() ?? null,
    sync_config: project.syncConfig ?? null,
    custom_fields: project.customFields ?? null,
    tags: project.tags,
    team: project.team ? mapTeam(project.team) : null,
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
    sla_status: task.slaStatus,
    cycle_time_hours: task.cycleTimeHours,
    related_pr_ids: task.relatedPrIds,
    tags: task.tags,
    custom_fields: task.customFields ?? null
  };
}

function mapUser(user: { id: string; tenantId: string; email: string; fullName: string; role: string; isActive: boolean; createdAt: Date }) {
  return {
    id: user.id,
    tenant_id: user.tenantId,
    email: user.email,
    full_name: user.fullName,
    role: user.role,
    is_active: user.isActive,
    created_at: user.createdAt.toISOString()
  };
}

function mapTeamMember(member: { id: string; teamId: string; userId: string; tenantId: string; createdAt: Date; user: { id: string; tenantId: string; email: string; fullName: string; role: string; isActive: boolean; createdAt: Date } }) {
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
}
