import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import type {
  CreateEpicInput,
  CreateProjectInput,
  CreateTaskInput,
  CreateTeamInput,
  UpdateTaskInput
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

export async function createProject(input: CreateProjectInput) {
  await ensureTenant(input.tenant_id);

  return prisma.project.create({
    data: {
      tenantId: input.tenant_id,
      key: input.key,
      name: input.name,
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

export async function getProject(projectId: string, tenantId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, tenantId },
    include: {
      team: true,
      epics: true,
      tasks: true
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
