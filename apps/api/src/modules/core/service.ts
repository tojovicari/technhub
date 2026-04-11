import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import type {
  AddProjectSourceInput,
  AddTeamMemberInput,
  CreateEpicInput,
  CreateProjectInput,
  CreateTaskInput,
  CreateTeamInput,
  CreateUserInput,
  ListQueryInput,
  UpdateProjectInput,
  UpdateTaskInput,
  UpdateTeamInput
} from './schema.js';

async function ensureTenant(tenantId: string) {
  await prisma.tenant.upsert({
    where: { id: tenantId },
    create: {
      id: tenantId,
      name: `Tenant ${tenantId}`,
      slug: tenantId
    },
    update: {}
  });
}

export async function createTeam(input: CreateTeamInput) {
  await ensureTenant(input.tenant_id);

  return prisma.team.create({
    data: {
      tenantId: input.tenant_id,
      name: input.name,
      description: input.description,
      leadId: input.lead_id,
      budgetQuarterly: input.budget_quarterly,
      tags: input.tags
    }
  });
}

export async function updateTeam(teamId: string, tenantId: string, input: UpdateTeamInput) {
  const team = await prisma.team.findFirst({ where: { id: teamId, tenantId } });
  if (!team) {
    return null;
  }

  return prisma.team.update({
    where: { id: teamId },
    data: {
      name: input.name,
      description: input.description === undefined ? undefined : input.description,
      leadId: input.lead_id === undefined ? undefined : input.lead_id,
      budgetQuarterly: input.budget_quarterly === undefined ? undefined : input.budget_quarterly,
      tags: input.tags
    }
  });
}

export async function createProject(input: CreateProjectInput) {
  await ensureTenant(input.tenant_id);

  return prisma.project.create({
    data: {
      tenantId: input.tenant_id,
      key: input.key,
      name: input.name,
      isInitiative: input.is_initiative ?? true,
      teamId: input.team_id,
      status: input.status,
      startDate: input.start_date ? new Date(input.start_date) : null,
      targetEndDate: input.target_end_date ? new Date(input.target_end_date) : null,
      syncConfig: (input.sync_config ?? undefined) as Prisma.InputJsonValue | undefined,
      customFields: (input.custom_fields ?? undefined) as Prisma.InputJsonValue | undefined,
      tags: input.tags
    }
  });
}

export async function updateProject(projectId: string, tenantId: string, input: UpdateProjectInput) {
  const project = await prisma.project.findFirst({ where: { id: projectId, tenantId } });
  if (!project) return null;

  return prisma.project.update({
    where: { id: projectId },
    data: {
      name: input.name,
      isInitiative: input.is_initiative,
      teamId: input.team_id === undefined ? undefined : input.team_id,
      status: input.status,
      startDate: input.start_date === undefined ? undefined : (input.start_date ? new Date(input.start_date) : null),
      targetEndDate: input.target_end_date === undefined ? undefined : (input.target_end_date ? new Date(input.target_end_date) : null),
      tags: input.tags
    }
  });
}

export async function getProject(projectId: string, tenantId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, tenantId },
    include: {
      team: true,
      epics: true,
      tasks: true,
      sources: true
    }
  });
}

export async function createEpic(input: CreateEpicInput) {
  await ensureTenant(input.tenant_id);

  return prisma.epic.create({
    data: {
      tenantId: input.tenant_id,
      projectId: input.project_id,
      source: input.source,
      sourceId: input.source_id,
      name: input.name,
      description: input.description,
      goal: input.goal,
      status: input.status,
      ownerId: input.owner_id,
      startDate: input.start_date ? new Date(input.start_date) : null,
      targetEndDate: input.target_end_date ? new Date(input.target_end_date) : null
    }
  });
}

export async function getEpic(epicId: string, tenantId: string) {
  return prisma.epic.findFirst({
    where: { id: epicId, tenantId },
    include: {
      project: true,
      tasks: true
    }
  });
}

function deriveTaskLifecycle(status: string, current?: { startedAt: Date | null; completedAt: Date | null }) {
  const startedAt = current?.startedAt ?? null;
  const completedAt = current?.completedAt ?? null;

  if (status === 'in_progress' && !startedAt) {
    return { startedAt: new Date(), completedAt };
  }

  if (status === 'done' && !completedAt) {
    return {
      startedAt: startedAt ?? new Date(),
      completedAt: new Date()
    };
  }

  return { startedAt, completedAt };
}

function calculateCycleTimeHours(startedAt: Date | null, completedAt: Date | null) {
  if (!startedAt || !completedAt) {
    return null;
  }

  return Number(((completedAt.getTime() - startedAt.getTime()) / 3600000).toFixed(2));
}

async function refreshEpicCounters(epicId: string | null | undefined) {
  if (!epicId) {
    return;
  }

  const tasks = await prisma.task.findMany({
    where: { epicId },
    select: {
      status: true,
      storyPoints: true,
      hoursActual: true
    }
  });

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((task) => task.status === 'done').length;
  const totalStoryPoints = tasks.reduce((sum, task) => sum + (task.storyPoints ?? 0), 0);
  const actualHours = Number(tasks.reduce((sum, task) => sum + (task.hoursActual ?? 0), 0).toFixed(2));

  await prisma.epic.update({
    where: { id: epicId },
    data: {
      totalTasks,
      completedTasks,
      totalStoryPoints,
      actualHours
    }
  });
}

export async function createTask(input: CreateTaskInput) {
  await ensureTenant(input.tenant_id);

  const lifecycle = deriveTaskLifecycle(input.status);
  const cycleTimeHours = calculateCycleTimeHours(lifecycle.startedAt, lifecycle.completedAt);

  const task = await prisma.task.create({
    data: {
      tenantId: input.tenant_id,
      source: input.source,
      sourceId: input.source_id,
      projectId: input.project_id,
      epicId: input.epic_id,
      title: input.title,
      description: input.description,
      taskType: input.task_type,
      priority: input.priority,
      status: input.status,
      assigneeId: input.assignee_id,
      reporterId: input.reporter_id,
      storyPoints: input.story_points,
      hoursEstimated: input.hours_estimated,
      startedAt: lifecycle.startedAt,
      completedAt: lifecycle.completedAt,
      dueDate: input.due_date ? new Date(input.due_date) : null,
      cycleTimeHours,
      relatedPrIds: input.related_pr_ids,
      tags: input.tags,
      customFields: (input.custom_fields ?? undefined) as Prisma.InputJsonValue | undefined
    }
  });

  await refreshEpicCounters(task.epicId);
  return task;
}

export async function updateTask(taskId: string, tenantId: string, input: UpdateTaskInput) {
  const current = await prisma.task.findFirst({
    where: { id: taskId, tenantId }
  });

  if (!current) {
    return null;
  }

  const lifecycle = input.status
    ? deriveTaskLifecycle(input.status, current)
    : { startedAt: current.startedAt, completedAt: current.completedAt };

  const cycleTimeHours = calculateCycleTimeHours(lifecycle.startedAt, lifecycle.completedAt);

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      title: input.title,
      description: input.description,
      priority: input.priority,
      status: input.status,
      assigneeId: input.assignee_id === undefined ? undefined : input.assignee_id,
      storyPoints: input.story_points === undefined ? undefined : input.story_points,
      hoursEstimated: input.hours_estimated === undefined ? undefined : input.hours_estimated,
      hoursActual: input.hours_actual === undefined ? undefined : input.hours_actual,
      dueDate: input.due_date === undefined ? undefined : (input.due_date ? new Date(input.due_date) : null),
      tags: input.tags,
      customFields: input.custom_fields === undefined ? undefined : (input.custom_fields as Prisma.InputJsonValue | undefined),
      startedAt: lifecycle.startedAt,
      completedAt: lifecycle.completedAt,
      cycleTimeHours
    }
  });

  await refreshEpicCounters(task.epicId);
  return task;
}

export async function getTask(taskId: string, tenantId: string) {
  return prisma.task.findFirst({
    where: { id: taskId, tenantId },
    include: {
      project: true,
      epic: true,
      assignee: true,
      reporter: true
    }
  });
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(input: CreateUserInput) {
  await ensureTenant(input.tenant_id);

  return prisma.user.upsert({
    where: { tenantId_email: { tenantId: input.tenant_id, email: input.email } },
    create: {
      tenantId: input.tenant_id,
      email: input.email,
      fullName: input.full_name,
      role: input.role
    },
    update: {
      fullName: input.full_name,
      role: input.role
    }
  });
}

export async function listTeams(tenantId: string, query: ListQueryInput) {
  const { limit, cursor } = query;

  const rows = await prisma.team.findMany({
    where: { tenantId },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'asc' }
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export async function listUsers(tenantId: string, limit: number, cursor?: string) {
  const rows = await prisma.user.findMany({
    where: { tenantId },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'asc' }
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

// ─── Team members ─────────────────────────────────────────────────────────────

export async function addTeamMember(teamId: string, tenantId: string, input: AddTeamMemberInput) {
  const [team, user] = await Promise.all([
    prisma.team.findFirst({ where: { id: teamId, tenantId } }),
    prisma.user.findFirst({ where: { id: input.user_id, tenantId } })
  ]);

  if (!team || !user) {
    return null;
  }

  return prisma.teamMember.upsert({
    where: { teamId_userId: { teamId, userId: input.user_id } },
    create: { teamId, userId: input.user_id, tenantId },
    update: {}
  });
}

export async function removeTeamMember(teamId: string, userId: string, tenantId: string) {
  const member = await prisma.teamMember.findFirst({
    where: { teamId, userId, tenantId }
  });

  if (!member) {
    return null;
  }

  return prisma.teamMember.delete({ where: { id: member.id } });
}

export async function listTeamMembers(teamId: string, tenantId: string) {
  const team = await prisma.team.findFirst({ where: { id: teamId, tenantId } });
  if (!team) {
    return null;
  }

  return prisma.teamMember.findMany({
    where: { teamId, tenantId },
    include: { user: true },
    orderBy: { createdAt: 'asc' }
  });
}

// ─── Project sources ─────────────────────────────────────────────────────────

export async function addProjectSource(projectId: string, tenantId: string, input: AddProjectSourceInput) {
  const project = await prisma.project.findFirst({ where: { id: projectId, tenantId } });
  if (!project) {
    return null;
  }

  return prisma.projectSource.upsert({
    where: { projectId_provider_externalId: { projectId, provider: input.provider, externalId: input.external_id } },
    create: { projectId, tenantId, provider: input.provider, externalId: input.external_id, displayName: input.display_name },
    update: { displayName: input.display_name }
  });
}

export async function removeProjectSource(projectId: string, sourceId: string, tenantId: string) {
  const source = await prisma.projectSource.findFirst({
    where: { id: sourceId, projectId, tenantId }
  });

  if (!source) {
    return null;
  }

  return prisma.projectSource.delete({ where: { id: source.id } });
}

export async function listProjectSources(projectId: string, tenantId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, tenantId } });
  if (!project) {
    return null;
  }

  return prisma.projectSource.findMany({
    where: { projectId, tenantId },
    orderBy: { createdAt: 'asc' }
  });
}

// ─── List operations with cursor pagination ────────────────────────────────────

export async function listProjects(tenantId: string, query: ListQueryInput) {
  const { limit, cursor, status, is_initiative } = query;
  const where: Prisma.ProjectWhereInput = { tenantId };
  if (status) {
    where.status = status as Prisma.EnumProjectStatusFilter;
  }
  if (is_initiative !== undefined) {
    where.isInitiative = is_initiative === 'true';
  }

  const rows = await prisma.project.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' }
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export async function listEpics(tenantId: string, query: ListQueryInput) {
  const { limit, cursor, status, project_id } = query;
  const where: Prisma.EpicWhereInput = { tenantId };
  if (status) {
    where.status = status as Prisma.EnumEpicStatusFilter;
  }

  if (project_id) {
    where.projectId = project_id;
  }

  const rows = await prisma.epic.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' }
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export async function listTasks(tenantId: string, query: ListQueryInput) {
  const { limit, cursor, status, project_id, epic_id, assignee_id } = query;
  const where: Prisma.TaskWhereInput = { tenantId };
  if (status) {
    where.status = status as Prisma.EnumTaskStatusFilter;
  }

  if (project_id) {
    where.projectId = project_id;
  }

  if (epic_id) {
    where.epicId = epic_id;
  }

  if (assignee_id) {
    where.assigneeId = assignee_id;
  }

  const rows = await prisma.task.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' }
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
