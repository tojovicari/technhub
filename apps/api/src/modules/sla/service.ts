import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Prisma as PrismaEnum } from '@prisma/client';
import { evaluateCondition, computeSlaStatus } from './engine.js';
import type { SlaConditionGroup } from './schema.js';
import type {
  createSlaTemplateSchema,
  updateSlaTemplateSchema,
  listSlaTemplatesQuerySchema,
  slaComplianceQuerySchema
} from './schema.js';
import type { z } from 'zod';

type CreateSlaTemplateInput = z.infer<typeof createSlaTemplateSchema>;
type UpdateSlaTemplateInput = z.infer<typeof updateSlaTemplateSchema>;
type ListSlaTemplatesQuery = z.infer<typeof listSlaTemplatesQuerySchema>;
type SlaComplianceQuery = z.infer<typeof slaComplianceQuerySchema>;

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

  await prisma.slaTemplate.delete({ where: { id } });
  return true;
}

// ────────────────────────────────────────────────────────────────────────────────
// SLA Compliance — on-demand calculation over tasks
// ────────────────────────────────────────────────────────────────────────────────

export async function getSlaCompliance(tenantId: string, query: SlaComplianceQuery) {
  const from = new Date(query.from);
  const to = new Date(query.to);
  const now = new Date();
  // For historical periods in the past, cap at `to`; for open periods, cap at now
  const effectiveTo = now < to ? now : to;

  // Load active templates (optionally filtered by template_id)
  const templates = await prisma.slaTemplate.findMany({
    where: {
      tenantId,
      isActive: true,
      ...(query.template_id && { id: query.template_id })
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
  });

  // Tasks active within the period:
  //   started_at is set AND started before period end
  //   AND (still running OR completed after period start)
  const tasks = await prisma.task.findMany({
    where: {
      tenantId,
      startedAt: { not: null, lte: to },
      OR: [
        { completedAt: null },
        { completedAt: { gte: from } }
      ],
      ...(query.project_id && { projectId: query.project_id })
    }
  });

  type SlaStatus = 'running' | 'at_risk' | 'breached' | 'met';

  type TaskComplianceItem = {
    task_id: string;
    source_id: string | null;
    title: string;
    priority: string;
    task_type: string | null;
    status: string;
    source: string;
    started_at: string;
    completed_at: string | null;
    target_minutes: number;
    elapsed_minutes: number;
    deadline_at: string;
    sla_status: SlaStatus;
    breach_minutes: number | null;
  };

  const result = [];

  for (const template of templates) {
    const rulesMap = template.rules as Record<
      string,
      { target_minutes: number; warning_at_percent: number }
    >;
    const condition = template.condition as unknown as SlaConditionGroup;

    const taskResults: TaskComplianceItem[] = [];
    let met = 0, running = 0, at_risk = 0, breached = 0;

    for (const task of tasks) {
      // Filter by applies_to (empty = any type)
      if (
        template.appliesTo.length > 0 &&
        (!task.taskType || !template.appliesTo.includes(task.taskType))
      ) {
        continue;
      }

      // Filter by project_ids on the template (empty = any project)
      if (template.projectIds.length > 0 && !template.projectIds.includes(task.projectId)) {
        continue;
      }

      // Evaluate condition DSL against task fields
      const eventRecord: Record<string, unknown> = {
        task_type: task.taskType,
        original_type: task.originalType,
        priority: task.priority,
        status: task.status,
        labels: task.tags,
        source: task.source,
        project_id: task.projectId
      };

      if (!evaluateCondition(condition, eventRecord)) continue;

      // Get rule for this task's priority
      const rule = rulesMap[task.priority];
      if (!rule) continue;

      const startedAt = task.startedAt!;
      const isTerminal = task.status === 'done' || task.status === 'cancelled';

      // End time: terminal tasks use completedAt (capped at effectiveTo); active tasks use effectiveTo
      let endTime: Date;
      if (isTerminal && task.completedAt) {
        endTime = task.completedAt < effectiveTo ? task.completedAt : effectiveTo;
      } else {
        endTime = effectiveTo;
      }

      const clock = computeSlaStatus(startedAt, rule.target_minutes, rule.warning_at_percent, endTime);

      // For terminal tasks, collapse to met/breached (no at_risk/running)
      const slaStatus: SlaStatus = isTerminal
        ? clock.status === 'breached' ? 'breached' : 'met'
        : clock.status;

      switch (slaStatus) {
        case 'met': met++; break;
        case 'running': running++; break;
        case 'at_risk': at_risk++; break;
        case 'breached': breached++; break;
      }

      taskResults.push({
        task_id: task.id,
        source_id: task.sourceId ?? null,
        title: task.title,
        priority: task.priority,
        task_type: task.taskType ?? null,
        status: task.status,
        source: task.source,
        started_at: startedAt.toISOString(),
        completed_at: task.completedAt?.toISOString() ?? null,
        target_minutes: rule.target_minutes,
        elapsed_minutes: clock.elapsed_minutes,
        deadline_at: clock.deadline_at.toISOString(),
        sla_status: slaStatus,
        breach_minutes: clock.breach_minutes
      });
    }

    if (taskResults.length === 0) continue;

    const terminal = met + breached;
    const complianceRate = terminal > 0 ? Math.round((met / terminal) * 1000) / 10 : null;

    result.push({
      template_id: template.id,
      template_name: template.name,
      summary: { total: taskResults.length, met, running, at_risk, breached, compliance_rate: complianceRate },
      tasks: taskResults
    });
  }

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    templates: result
  };
}
