import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Prisma as PrismaEnum } from '@prisma/client';
import { evaluateCondition, computeSlaStatus, isTaskTerminal, isTaskActive } from './engine.js';
import type { SlaTaskEvent, SlaConditionGroup } from './schema.js';
import type {
  createSlaTemplateSchema,
  updateSlaTemplateSchema,
  listSlaTemplatesQuerySchema,
  listSlaInstancesQuerySchema
} from './schema.js';
import type { z } from 'zod';

type CreateSlaTemplateInput = z.infer<typeof createSlaTemplateSchema>;
type UpdateSlaTemplateInput = z.infer<typeof updateSlaTemplateSchema>;
type ListSlaTemplatesQuery = z.infer<typeof listSlaTemplatesQuerySchema>;
type ListSlaInstancesQuery = z.infer<typeof listSlaInstancesQuerySchema>;

// ────────────────────────────────────────────────────────────────────────────────
// Template CRUD
// ────────────────────────────────────────────────────────────────────────────────

export async function createSlaTemplate(tenantId: string, input: CreateSlaTemplateInput) {
  return prisma.slaTemplate.create({
    data: {
      tenantId,
      name: input.name,
      description: input.description,
      condition: input.condition as Prisma.InputJsonValue,
      priority: input.priority,
      appliesTo: input.applies_to,
      rules: input.rules as Prisma.InputJsonValue,
      escalationRule: (input.escalation_rule ?? undefined) as Prisma.InputJsonValue | undefined,
      projectIds: input.project_ids ?? [],
      isDefault: input.is_default ?? false
    }
  });
}

export async function listSlaTemplates(tenantId: string, query: ListSlaTemplatesQuery) {
  const where: Prisma.SlaTemplateWhereInput = { tenantId };

  if (query.is_active !== undefined) {
    where.isActive = query.is_active;
  }

  const limit = query.limit;
  const items = await prisma.slaTemplate.findMany({
    where,
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    take: limit + 1,
    cursor: query.cursor ? { id: query.cursor } : undefined
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;

  return {
    data: page,
    next_cursor: hasMore ? page[page.length - 1].id : null
  };
}

export async function getSlaTemplate(id: string, tenantId: string) {
  const template = await prisma.slaTemplate.findFirst({ where: { id, tenantId } });
  return template ?? null;
}

export async function updateSlaTemplate(
  id: string,
  tenantId: string,
  input: UpdateSlaTemplateInput
) {
  const existing = await prisma.slaTemplate.findFirst({ where: { id, tenantId } });
  if (!existing) return null;

  return prisma.slaTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.condition !== undefined && { condition: input.condition as Prisma.InputJsonValue }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.applies_to !== undefined && { appliesTo: input.applies_to }),
      ...(input.rules !== undefined && { rules: input.rules as Prisma.InputJsonValue }),
      ...(input.escalation_rule !== undefined && {
        escalationRule:
          input.escalation_rule === null || input.escalation_rule === undefined
            ? PrismaEnum.JsonNull
            : (input.escalation_rule as Prisma.InputJsonValue)
      }),
      ...(input.project_ids !== undefined && { projectIds: input.project_ids }),
      ...(input.is_default !== undefined && { isDefault: input.is_default }),
      ...(input.is_active !== undefined && { isActive: input.is_active })
    }
  });
}

export async function deleteSlaTemplate(id: string, tenantId: string) {
  const existing = await prisma.slaTemplate.findFirst({ where: { id, tenantId } });
  if (!existing) return null;

  await prisma.$transaction([
    prisma.slaInstance.deleteMany({ where: { slaTemplateId: id } }),
    prisma.slaTemplate.delete({ where: { id } }),
  ]);
  return true;
}

// ────────────────────────────────────────────────────────────────────────────────
// SLA Engine: evaluate a task event
// ────────────────────────────────────────────────────────────────────────────────

async function upsertTaskSnapshot(event: SlaTaskEvent): Promise<void> {
  if (!event.title || !event.project_id) return;
  await prisma.slaTaskSnapshot.upsert({
    where: { taskId: event.task_id },
    create: {
      taskId: event.task_id,
      tenantId: event.tenant_id,
      title: event.title,
      assigneeId: event.assignee_id ?? null,
      priority: event.priority,
      projectId: event.project_id
    },
    update: {
      title: event.title,
      assigneeId: event.assignee_id ?? null,
      priority: event.priority,
      projectId: event.project_id
    }
  });
}

export async function evaluateTaskSla(event: SlaTaskEvent): Promise<{
  instance_id: string | null;
  status: string;
  action: 'created' | 'updated' | 'closed' | 'noop';
}> {
  // Upsert local read-model with task metadata (snapshot from core.task.updated.v1)
  await upsertTaskSnapshot(event).catch(() => {}); // non-blocking, best-effort

  // Load active templates for the tenant, ordered by priority
  const templates = await prisma.slaTemplate.findMany({
    where: { tenantId: event.tenant_id, isActive: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
  });

  // Find active SLA instance for this task
  const activeInstance = await prisma.slaInstance.findFirst({
    where: { taskId: event.task_id, tenantId: event.tenant_id, status: { in: ['running', 'at_risk'] } }
  });

  // If task is terminal, close any active instance
  if (isTaskTerminal(event)) {
    if (activeInstance) {
      const now = new Date();
      const elapsedMinutes = Math.round(
        (now.getTime() - activeInstance.startedAt.getTime()) / 60_000
      );
      const isBreached = now > activeInstance.deadlineAt;
      const updatedInstance = await prisma.slaInstance.update({
        where: { id: activeInstance.id },
        data: {
          status: isBreached ? 'breached' : 'met',
          completedAt: now,
          actualMinutes: elapsedMinutes,
          breachMinutes: isBreached
            ? Math.round((now.getTime() - activeInstance.deadlineAt.getTime()) / 60_000)
            : null
        }
      });
      // Sync slaStatus on the task
      await prisma.task.update({
        where: { id: event.task_id },
        data: { slaStatus: isBreached ? 'breached' : 'ok' }
      });
      return { instance_id: updatedInstance.id, status: updatedInstance.status, action: 'closed' };
    }
    return { instance_id: null, status: 'noop', action: 'noop' };
  }

  // Only start SLA clock when task becomes active (in_progress / review)
  if (!isTaskActive(event)) {
    return { instance_id: activeInstance?.id ?? null, status: 'noop', action: 'noop' };
  }

  // Evaluate conditions to find matching template
  const eventRecord = event as unknown as Record<string, unknown>;
  let matchedTemplate: (typeof templates)[number] | null = null;

  for (const template of templates) {
    // Filter by applies_to — empty array means no type restriction (use condition DSL only)
    if (template.appliesTo.length > 0 && (!event.task_type || !template.appliesTo.includes(event.task_type))) continue;

    // Filter by project_ids (empty = any project)
    if (
      template.projectIds.length > 0 &&
      event.project_id &&
      !template.projectIds.includes(event.project_id)
    ) {
      continue;
    }

    const condition = template.condition as unknown as SlaConditionGroup;
    if (evaluateCondition(condition, eventRecord)) {
      matchedTemplate = template;
      break;
    }

    // Fallback to is_default
    if (template.isDefault && !matchedTemplate) {
      matchedTemplate = template;
    }
  }

  if (!matchedTemplate) {
    // No template matched — close any open instance as superseded
    if (activeInstance) {
      await prisma.slaInstance.update({
        where: { id: activeInstance.id },
        data: { status: 'superseded' }
      });
      await prisma.task.update({ where: { id: event.task_id }, data: { slaStatus: 'n_a' } });
    }
    return { instance_id: null, status: 'noop', action: 'noop' };
  }

  // Extract rule for this task's priority
  const rulesMap = matchedTemplate.rules as Record<
    string,
    { target_minutes: number; warning_at_percent: number }
  >;
  const rule = rulesMap[event.priority];

  if (!rule) {
    return { instance_id: null, status: 'noop', action: 'noop' };
  }

  const startedAt = event.started_at ? new Date(event.started_at) : new Date();

  // If active instance is already from the same template, recompute status only
  if (activeInstance && activeInstance.slaTemplateId === matchedTemplate.id) {
    const clock = computeSlaStatus(
      activeInstance.startedAt,
      activeInstance.targetMinutes,
      0, // warning_at_percent doesn't change status in DB, alerting handled by scheduler
      new Date()
    );
    const nextStatus = clock.status === 'at_risk' ? 'at_risk' : activeInstance.status;
    if (nextStatus !== activeInstance.status) {
      const updated = await prisma.slaInstance.update({
        where: { id: activeInstance.id },
        data: {
          status: nextStatus as 'running' | 'at_risk' | 'met' | 'breached' | 'superseded',
          breachMinutes: clock.breach_minutes
        }
      });
      await prisma.task.update({
        where: { id: event.task_id },
        data: { slaStatus: nextStatus === 'at_risk' ? 'at_risk' : 'ok' }
      });
      return { instance_id: updated.id, status: updated.status, action: 'updated' };
    }
    return { instance_id: activeInstance.id, status: activeInstance.status, action: 'noop' };
  }

  // Close existing instance (different template) and create new one
  if (activeInstance) {
    await prisma.slaInstance.update({
      where: { id: activeInstance.id },
      data: { status: 'superseded' }
    });
  }

  const deadlineAt = new Date(startedAt.getTime() + rule.target_minutes * 60_000);
  const newInstance = await prisma.slaInstance.create({
    data: {
      taskId: event.task_id,
      slaTemplateId: matchedTemplate.id,
      tenantId: event.tenant_id,
      targetMinutes: rule.target_minutes,
      startedAt,
      deadlineAt,
      status: 'running'
    }
  });

  await prisma.task.update({ where: { id: event.task_id }, data: { slaStatus: 'ok' } });

  return { instance_id: newInstance.id, status: newInstance.status, action: 'created' };
}

// ────────────────────────────────────────────────────────────────────────────────
// SLA Instance list (for dashboards)
// ────────────────────────────────────────────────────────────────────────────────

export async function listSlaInstances(tenantId: string, query: ListSlaInstancesQuery) {
  const where: Prisma.SlaInstanceWhereInput = { tenantId };

  if (query.task_id) where.taskId = query.task_id;
  if (query.status) where.status = query.status;

  const limit = query.limit;
  const items = await prisma.slaInstance.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    cursor: query.cursor ? { id: query.cursor } : undefined,
    include: { template: { select: { id: true, name: true } } }
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;

  // Enrich with local task snapshot (SLA-owned read-model, no cross-module DB access)
  const taskIds = page.map((i) => i.taskId);
  const snapshots = taskIds.length
    ? await prisma.slaTaskSnapshot.findMany({ where: { taskId: { in: taskIds } } })
    : [];
  const snapshotMap = new Map(snapshots.map((s) => [s.taskId, s]));

  return {
    data: page.map((inst) => ({ ...inst, task_snapshot: snapshotMap.get(inst.taskId) ?? null })),
    next_cursor: hasMore ? page[page.length - 1].id : null
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// Periodic tick: update running instances' status (called by scheduler)
// ────────────────────────────────────────────────────────────────────────────────

export async function tickSlaInstances(tenantId?: string): Promise<number> {
  const now = new Date();
  const where: Prisma.SlaInstanceWhereInput = {
    status: { in: ['running', 'at_risk'] },
    ...(tenantId && { tenantId })
  };

  const instances = await prisma.slaInstance.findMany({
    where,
    include: { template: true }
  });

  let updated = 0;

  for (const inst of instances) {
    const rulesMap = inst.template.rules as Record<
      string,
      { target_minutes: number; warning_at_percent: number }
    >;

    // We don't know the priority on the instance directly — use targetMinutes to check
    const isBreached = now > inst.deadlineAt;
    const elapsedMinutes = (now.getTime() - inst.startedAt.getTime()) / 60_000;

    // Find warning threshold from rules
    const matchingRule = Object.values(rulesMap).find(
      (r) => r.target_minutes === inst.targetMinutes
    );
    const warningPercent = matchingRule?.warning_at_percent ?? 0;
    const warningThreshold = (warningPercent / 100) * inst.targetMinutes;
    const isAtRisk = !isBreached && warningPercent > 0 && elapsedMinutes >= warningThreshold;

    if (isBreached && inst.status !== 'breached') {
      await prisma.slaInstance.update({
        where: { id: inst.id },
        data: {
          status: 'breached',
          breachMinutes: Math.round(elapsedMinutes - inst.targetMinutes)
        }
      });
      await prisma.task.update({ where: { id: inst.taskId }, data: { slaStatus: 'breached' } });
      updated++;
    } else if (isAtRisk && inst.status !== 'at_risk') {
      await prisma.slaInstance.update({ where: { id: inst.id }, data: { status: 'at_risk' } });
      await prisma.task.update({ where: { id: inst.taskId }, data: { slaStatus: 'at_risk' } });
      updated++;
    }
  }

  return updated;
}

// ────────────────────────────────────────────────────────────────────────────────
// SLA Summary — overall metrics
// ────────────────────────────────────────────────────────────────────────────────

export async function getSlaSummary(
  tenantId: string,
  opts: { projectId?: string; from?: string; to?: string }
) {
  const where: Prisma.SlaInstanceWhereInput = { tenantId };
  if (opts.from || opts.to) {
    where.startedAt = {
      ...(opts.from && { gte: new Date(opts.from) }),
      ...(opts.to && { lte: new Date(opts.to) })
    };
  }
  if (opts.projectId) {
    where.task = { projectId: opts.projectId };
  }

  const instances = await prisma.slaInstance.findMany({
    where,
    select: { status: true, actualMinutes: true, breachMinutes: true }
  });

  const counts = { running: 0, at_risk: 0, breached: 0, met: 0, superseded: 0 };
  let totalActualMinutes = 0;
  let resolvedCount = 0;
  let totalBreachMinutes = 0;
  let breachedCount = 0;

  for (const inst of instances) {
    const s = inst.status as keyof typeof counts;
    if (s in counts) counts[s]++;

    if ((inst.status === 'met' || inst.status === 'breached') && inst.actualMinutes != null) {
      totalActualMinutes += inst.actualMinutes;
      resolvedCount++;
    }
    if (inst.status === 'breached' && inst.breachMinutes != null) {
      totalBreachMinutes += inst.breachMinutes;
      breachedCount++;
    }
  }

  const total = instances.length;
  const closedTotal = counts.met + counts.breached;

  return {
    period: { from: opts.from ?? null, to: opts.to ?? null },
    total_instances: total,
    running: counts.running,
    at_risk: counts.at_risk,
    breached: counts.breached,
    met: counts.met,
    compliance_rate: closedTotal > 0 ? Math.round((counts.met / closedTotal) * 1000) / 10 : null,
    breach_rate: closedTotal > 0 ? Math.round((counts.breached / closedTotal) * 1000) / 10 : null,
    at_risk_rate: counts.running + counts.at_risk > 0
      ? Math.round((counts.at_risk / (counts.running + counts.at_risk)) * 1000) / 10
      : null,
    mean_resolution_minutes: resolvedCount > 0 ? Math.round(totalActualMinutes / resolvedCount) : null,
    breach_severity_avg_minutes: breachedCount > 0 ? Math.round(totalBreachMinutes / breachedCount) : null
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// SLA Summary — breakdown by template
// ────────────────────────────────────────────────────────────────────────────────

export async function getSlaSummaryByTemplate(
  tenantId: string,
  opts: { projectId?: string; from?: string; to?: string }
) {
  const where: Prisma.SlaInstanceWhereInput = { tenantId };
  if (opts.from || opts.to) {
    where.startedAt = {
      ...(opts.from && { gte: new Date(opts.from) }),
      ...(opts.to && { lte: new Date(opts.to) })
    };
  }
  if (opts.projectId) {
    where.task = { projectId: opts.projectId };
  }

  const instances = await prisma.slaInstance.findMany({
    where,
    select: {
      status: true,
      actualMinutes: true,
      breachMinutes: true,
      slaTemplateId: true,
      template: { select: { id: true, name: true, priority: true } }
    }
  });

  // Group by template
  const templateMap = new Map<string, {
    template: { id: string; name: string; priority: number };
    running: number; at_risk: number; breached: number; met: number;
    totalActualMinutes: number; resolvedCount: number;
    totalBreachMinutes: number; breachedCount: number;
  }>();

  for (const inst of instances) {
    const tid = inst.slaTemplateId;
    if (!templateMap.has(tid)) {
      templateMap.set(tid, {
        template: inst.template,
        running: 0, at_risk: 0, breached: 0, met: 0,
        totalActualMinutes: 0, resolvedCount: 0,
        totalBreachMinutes: 0, breachedCount: 0
      });
    }
    const entry = templateMap.get(tid)!;
    const s = inst.status as 'running' | 'at_risk' | 'breached' | 'met' | 'superseded';
    if (s in entry) (entry as unknown as Record<string, number>)[s]++;

    if ((inst.status === 'met' || inst.status === 'breached') && inst.actualMinutes != null) {
      entry.totalActualMinutes += inst.actualMinutes;
      entry.resolvedCount++;
    }
    if (inst.status === 'breached' && inst.breachMinutes != null) {
      entry.totalBreachMinutes += inst.breachMinutes;
      entry.breachedCount++;
    }
  }

  return Array.from(templateMap.values())
    .sort((a, b) => a.template.priority - b.template.priority)
    .map(e => {
      const closedTotal = e.met + e.breached;
      return {
        template: e.template,
        running: e.running,
        at_risk: e.at_risk,
        breached: e.breached,
        met: e.met,
        total_instances: e.running + e.at_risk + e.breached + e.met,
        compliance_rate: closedTotal > 0 ? Math.round((e.met / closedTotal) * 1000) / 10 : null,
        breach_rate: closedTotal > 0 ? Math.round((e.breached / closedTotal) * 1000) / 10 : null,
        mean_resolution_minutes: e.resolvedCount > 0 ? Math.round(e.totalActualMinutes / e.resolvedCount) : null,
        breach_severity_avg_minutes: e.breachedCount > 0 ? Math.round(e.totalBreachMinutes / e.breachedCount) : null
      };
    });
}
