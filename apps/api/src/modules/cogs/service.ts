import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  computeEntryCost,
  computeVelocity,
  estimateHoursFromStoryPoints,
  sumCost,
  sumByCategory,
  computeCostPerStoryPoint,
  computeBurnRate,
  computePlannedVsActual,
  computeRoi,
  resolveHourlyRate,
  deriveTaskCogs
} from './engine.js';
import type {
  CreateCogsEntryInput,
  ListCogsEntriesQuery,
  CogsRollupQuery,
  CreateCogsBudgetInput,
  BurnRateQuery,
  EstimateFromSpInput
} from './schema.js';

// ── Create entry ──────────────────────────────────────────────────────────────

export async function createCogsEntry(tenantId: string, input: CreateCogsEntryInput) {
  const totalCost = computeEntryCost(
    input.hours_worked,
    input.hourly_rate,
    input.overhead_rate
  );

  return prisma.cogsEntry.create({
    data: {
      tenantId,
      periodDate: new Date(input.period_date),
      userId: input.user_id,
      teamId: input.team_id,
      projectId: input.project_id,
      epicId: input.epic_id,
      taskId: input.task_id,
      hoursWorked: input.hours_worked,
      hourlyRate: input.hourly_rate,
      overheadRate: input.overhead_rate,
      totalCost,
      category: input.category,
      subcategory: input.subcategory,
      source: input.source,
      confidence: input.confidence,
      notes: input.notes,
      approvedBy: input.approved_by,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined
    }
  });
}

// ── Create entry from story points (auto-estimate) ────────────────────────────

export async function createCogsEntryFromStoryPoints(
  tenantId: string,
  input: EstimateFromSpInput
) {
  // compute velocity from recent completed tasks in project/epic
  const recentTasks = await prisma.task.findMany({
    where: {
      tenantId,
      ...(input.project_id && { projectId: input.project_id }),
      ...(input.epic_id && { epicId: input.epic_id }),
      storyPoints: { gt: 0 },
      hoursActual: { gt: 0 },
      status: 'done'
    },
    select: { hoursActual: true, storyPoints: true },
    orderBy: { completedAt: 'desc' },
    take: 30
  });

  const history = recentTasks
    .filter((t) => t.hoursActual != null && t.storyPoints != null)
    .map((t) => ({ hoursActual: t.hoursActual!, storyPoints: t.storyPoints! }));

  const velocity = computeVelocity(history);
  const hoursEstimated = velocity
    ? estimateHoursFromStoryPoints(input.story_points, velocity)
    : input.story_points * 4; // fallback: 4h/point

  // get user's hourly rate
  const user = await prisma.user.findFirst({
    where: { id: input.user_id, tenantId },
    select: { id: true }
  });

  if (!user) throw new Error('USER_NOT_FOUND');

  const totalCost = computeEntryCost(hoursEstimated, 0, 1); // hourly_rate must be set by caller

  return prisma.cogsEntry.create({
    data: {
      tenantId,
      periodDate: new Date(input.period_date),
      userId: input.user_id,
      projectId: input.project_id,
      epicId: input.epic_id,
      hoursWorked: hoursEstimated,
      hourlyRate: 0, // caller must update with actual rate
      overheadRate: 1.0,
      totalCost,
      category: input.category,
      source: 'story_points',
      confidence: velocity ? 'medium' : 'low',
      notes: input.notes,
      metadata: {
        story_points: input.story_points,
        velocity_used: velocity,
        history_sample_size: history.length
      } as Prisma.InputJsonValue
    }
  });
}

// ── List entries ──────────────────────────────────────────────────────────────

export async function listCogsEntries(
  tenantId: string,
  query: ListCogsEntriesQuery & { superseded?: boolean }
) {
  const where: Prisma.CogsEntryWhereInput = { tenantId };
  if (query.project_id) where.projectId = query.project_id;
  if (query.epic_id)    where.epicId = query.epic_id;
  if (query.task_id)    where.taskId = query.task_id;
  if (query.team_id)    where.teamId = query.team_id;
  if (query.user_id)    where.userId = query.user_id;
  if (query.category)   where.category = query.category;
  if (query.source)     where.source = query.source;
  if (query.date_from || query.date_to) {
    where.periodDate = {
      ...(query.date_from && { gte: new Date(query.date_from) }),
      ...(query.date_to && { lte: new Date(query.date_to) })
    };
  }
  // superseded filter: true = only superseded entries, false = only active, undefined = all
  if (query.superseded === true)  where.supersededAt = { not: null };
  if (query.superseded === false) where.supersededAt = null;

  const limit = query.limit;
  const items = await prisma.cogsEntry.findMany({
    where,
    orderBy: { periodDate: 'desc' },
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

// ── Rollup ────────────────────────────────────────────────────────────────────

export async function computeCogsRollup(tenantId: string, query: CogsRollupQuery) {
  const where: Prisma.CogsEntryWhereInput = { tenantId };
  if (query.project_id) where.projectId = query.project_id;
  if (query.epic_id)    where.epicId = query.epic_id;
  if (query.team_id)    where.teamId = query.team_id;
  if (query.user_id)    where.userId = query.user_id;
  if (query.date_from || query.date_to) {
    where.periodDate = {
      ...(query.date_from && { gte: new Date(query.date_from) }),
      ...(query.date_to && { lte: new Date(query.date_to) })
    };
  }

  const entries = await prisma.cogsEntry.findMany({
    where,
    select: {
      totalCost: true,
      hoursWorked: true,
      category: true,
      userId: true,
      projectId: true,
      epicId: true,
      teamId: true
    }
  });

  const totalCost = sumCost(entries);
  const totalHours = entries.reduce((s, e) => s + e.hoursWorked, 0);

  // group_by breakdown
  let breakdown: Record<string, number> = {};
  if (query.group_by === 'category') {
    breakdown = sumByCategory(entries);
  } else {
    type EntryRow = typeof entries[0];
    const keyFns: Record<string, (e: EntryRow) => string> = {
      user: (e) => e.userId ?? 'unassigned',
      project: (e) => e.projectId ?? 'unassigned',
      epic: (e) => e.epicId ?? 'unassigned',
      team: (e) => e.teamId ?? 'unassigned'
    };
    const keyFn: (e: EntryRow) => string = keyFns[query.group_by] ?? ((e) => e.category);

    for (const entry of entries) {
      const key = keyFn(entry);
      breakdown[key] = Math.round(((breakdown[key] ?? 0) + entry.totalCost) * 100) / 100;
    }
  }

  // SP-based cost-per-point (only for project/epic scope)
  let costPerStoryPoint: number | null = null;
  if (query.project_id || query.epic_id) {
    const sp = await prisma.task.aggregate({
      where: {
        tenantId,
        ...(query.project_id && { projectId: query.project_id }),
        ...(query.epic_id && { epicId: query.epic_id }),
        storyPoints: { gt: 0 },
        status: 'done'
      },
      _sum: { storyPoints: true }
    });
    costPerStoryPoint = computeCostPerStoryPoint(totalCost, sp._sum.storyPoints ?? 0);
  }

  return {
    total_cost: totalCost,
    total_hours: Math.round(totalHours * 100) / 100,
    cost_per_story_point: costPerStoryPoint,
    group_by: query.group_by,
    breakdown,
    entry_count: entries.length,
    filters: {
      project_id: query.project_id ?? null,
      epic_id: query.epic_id ?? null,
      team_id: query.team_id ?? null,
      user_id: query.user_id ?? null,
      date_from: query.date_from ?? null,
      date_to: query.date_to ?? null
    }
  };
}

// ── Budget ────────────────────────────────────────────────────────────────────

export async function createCogsBudget(tenantId: string, input: CreateCogsBudgetInput) {
  return prisma.cogsBudget.upsert({
    where: {
      tenantId_projectId_teamId_period: {
        tenantId,
        projectId: input.project_id ?? '',
        teamId: input.team_id ?? '',
        period: input.period
      }
    },
    create: {
      tenantId,
      projectId: input.project_id,
      teamId: input.team_id,
      period: input.period,
      budgetAmount: input.budget_amount,
      currency: input.currency,
      notes: input.notes
    },
    update: {
      budgetAmount: input.budget_amount,
      currency: input.currency,
      notes: input.notes
    }
  });
}

export async function listCogsBudgets(tenantId: string, query: { project_id?: string; team_id?: string; period?: string }) {
  return prisma.cogsBudget.findMany({
    where: {
      tenantId,
      ...(query.project_id && { projectId: query.project_id }),
      ...(query.team_id && { teamId: query.team_id }),
      ...(query.period && { period: query.period })
    },
    orderBy: { period: 'desc' }
  });
}

// ── Burn rate ─────────────────────────────────────────────────────────────────

export async function getBurnRate(tenantId: string, query: BurnRateQuery) {
  // resolve date range from period string ("2026-Q2" or "2026-04")
  const { dateFrom, dateTo } = parsePeriod(query.period);

  const [entries, budgets] = await Promise.all([
    prisma.cogsEntry.findMany({
      where: {
        tenantId,
        ...(query.project_id && { projectId: query.project_id }),
        ...(query.team_id && { teamId: query.team_id }),
        periodDate: { gte: dateFrom, lte: dateTo }
      },
      select: { totalCost: true }
    }),
    prisma.cogsBudget.findMany({
      where: {
        tenantId,
        period: query.period,
        ...(query.project_id && { projectId: query.project_id }),
        ...(query.team_id && { teamId: query.team_id })
      }
    })
  ]);

  const actualCost = sumCost(entries);
  const budgetAmount = budgets.reduce((s, b) => s + b.budgetAmount, 0);
  const burnRate = computeBurnRate(actualCost, budgetAmount);

  return {
    period: query.period,
    period_start: dateFrom.toISOString().slice(0, 10),
    period_end: dateTo.toISOString().slice(0, 10),
    project_id: query.project_id ?? null,
    team_id: query.team_id ?? null,
    ...burnRate,
    budget_configured: budgetAmount > 0
  };
}

// ── Epic Planned vs Actual ────────────────────────────────────────────────────

export async function getEpicCogsAnalysis(tenantId: string, epicId: string) {
  const [epic, entries] = await Promise.all([
    prisma.epic.findFirst({
      where: { id: epicId, tenantId },
      select: {
        id: true,
        name: true,
        status: true,
        totalStoryPoints: true,
        actualHours: true,
        healthScore: true
      }
    }),
    prisma.cogsEntry.findMany({
      where: { tenantId, epicId },
      select: { totalCost: true, hoursWorked: true, category: true }
    })
  ]);

  if (!epic) return null;

  const actualCost = sumCost(entries);
  const byCategory = sumByCategory(entries);

  // estimated_cost and business_value stored inside CogsEntry.metadata for the epic
  // (set when a budget/plan entry is created with source='estimate' and epicId)
  const planEntry = await prisma.cogsEntry.findFirst({
    where: { tenantId, epicId, source: 'estimate' },
    select: { metadata: true },
    orderBy: { createdAt: 'desc' }
  });
  const planMeta = (planEntry?.metadata ?? {}) as Record<string, unknown>;
  const estimatedCost: number = typeof planMeta.estimated_cost === 'number'
    ? planMeta.estimated_cost
    : 0;
  const businessValue: number | null = typeof planMeta.business_value === 'number'
    ? planMeta.business_value
    : null;

  const pva = estimatedCost > 0
    ? computePlannedVsActual(estimatedCost, actualCost)
    : null;

  const roi = computeRoi(businessValue, actualCost);

  return {
    epic_id: epicId,
    epic_name: epic.name,
    epic_status: epic.status,
    actual_cost: actualCost,
    estimated_cost: estimatedCost || null,
    business_value: businessValue,
    roi_percent: roi,
    planned_vs_actual: pva,
    cost_by_category: byCategory,
    total_hours: Math.round(entries.reduce((s, e) => s + e.hoursWorked, 0) * 100) / 100
  };
}

// ── Initiative COGS derivation ────────────────────────────────────────────────

const TASK_FOR_COGS_SELECT = {
  id: true,
  status: true,
  hoursActual: true,
  hoursEstimated: true,
  storyPoints: true,
  epicId: true,
  projectId: true,
  assigneeId: true,
  completedAt: true
} as const;

const DEFAULT_OVERHEAD_RATE = 1.3;

type TaskCogsOutcome = 'created' | 'recreated' | 'skipped' | 'no_rate';

export interface GenerateCogsForTaskResult {
  taskId: string;
  outcome: TaskCogsOutcome;
  reason?: string;
  entryId?: string;
  warning?: string;
}

/**
 * Generate (or re-generate) a derived CogsEntry for a single task.
 *
 * Rules:
 * - task must be 'done' or 'cancelled' (with hoursActual > 0).
 * - If an active derived entry already exists, it is soft-deleted (supersededAt = now)
 *   and a new revision is created (idempotent re-trigger).
 * - Returns outcome: 'created' | 'recreated' | 'skipped' | 'no_rate'.
 */
export async function generateCogsForTask(
  tenantId: string,
  taskId: string,
  overheadRate = DEFAULT_OVERHEAD_RATE
): Promise<GenerateCogsForTaskResult> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, tenantId },
    select: {
      ...TASK_FOR_COGS_SELECT,
      assignee: { select: { id: true, hourlyRate: true } },
      project: {
        select: {
          id: true,
          isInitiative: true,
          team: { select: { id: true, hourlyRate: true } }
        }
      }
    }
  });

  if (!task) return { taskId, outcome: 'skipped', reason: 'task_not_found' };

  // Compute velocity from recent done tasks in the same project
  const recentTasks = await prisma.task.findMany({
    where: {
      tenantId,
      projectId: task.projectId,
      storyPoints: { gt: 0 },
      hoursActual: { gt: 0 },
      status: 'done'
    },
    select: { hoursActual: true, storyPoints: true },
    orderBy: { completedAt: 'desc' },
    take: 30
  });
  const velocity = computeVelocity(
    recentTasks
      .filter((t) => t.hoursActual != null && t.storyPoints != null)
      .map((t) => ({ hoursActual: t.hoursActual!, storyPoints: t.storyPoints! }))
  );

  const rate = resolveHourlyRate(
    task.assignee ?? null,
    task.project?.team ?? null
  );

  const derivation = deriveTaskCogs(
    { ...task, status: task.status as string },
    rate,
    overheadRate,
    velocity
  );

  if (derivation.kind === 'skip') {
    return { taskId, outcome: 'skipped', reason: derivation.reason };
  }

  const { input } = derivation;

  // Soft-delete any existing active derived entry for this task
  const existing = await prisma.cogsEntry.findFirst({
    where: { tenantId, taskId, isDerived: true, supersededAt: null },
    select: { id: true, revision: true }
  });

  const nextRevision = existing ? existing.revision + 1 : 1;
  const isRecreate = existing != null;

  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.cogsEntry.update({
        where: { id: existing.id },
        data: { supersededAt: new Date() }
      });
    }

    await tx.cogsEntry.create({
      data: {
        tenantId,
        periodDate: input.periodDate,
        userId: input.userId,
        projectId: input.projectId,
        epicId: input.epicId,
        taskId: input.taskId,
        hoursWorked: input.hoursWorked,
        hourlyRate: input.hourlyRate,
        overheadRate: input.overheadRate,
        totalCost: input.totalCost,
        category: input.category,
        subcategory: input.subcategory,
        source: input.source,
        confidence: input.confidence,
        isDerived: true,
        revision: nextRevision,
        notes: derivation.kind === 'no_rate'
          ? 'No hourly rate configured for user or team — cost recorded as $0.'
          : null,
        metadata: {
          ...input.metadata,
          ...(isRecreate && { previous_entry_id: existing!.id })
        } as Prisma.InputJsonValue
      }
    });
  });

  return {
    taskId,
    outcome: isRecreate ? 'recreated' : 'created',
    ...(derivation.kind === 'no_rate' && { warning: 'no_rate_configured', outcome: 'no_rate' as TaskCogsOutcome })
  };
}

/**
 * Generate derived COGS for all terminal tasks (done|cancelled) in an initiative.
 * Skips tasks that already have an up-to-date active derived entry.
 * Returns a per-task summary for auditability.
 */
export async function generateInitiativeCogs(
  tenantId: string,
  projectId: string,
  overheadRate = DEFAULT_OVERHEAD_RATE
): Promise<{ results: GenerateCogsForTaskResult[]; stats: Record<TaskCogsOutcome | 'skipped', number> }> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, tenantId, isInitiative: true },
    select: { id: true }
  });
  if (!project) throw new Error('INITIATIVE_NOT_FOUND');

  const tasks = await prisma.task.findMany({
    where: {
      tenantId,
      projectId,
      status: { in: ['done', 'cancelled'] }
    },
    select: { id: true }
  });

  const results: GenerateCogsForTaskResult[] = [];
  for (const t of tasks) {
    const r = await generateCogsForTask(tenantId, t.id, overheadRate);
    results.push(r);
  }

  const stats = { created: 0, recreated: 0, skipped: 0, no_rate: 0 } as Record<TaskCogsOutcome | 'skipped', number>;
  for (const r of results) stats[r.outcome] = (stats[r.outcome] ?? 0) + 1;

  return { results, stats };
}

/**
 * Return a cost summary for an initiative: total, delivery, waste, breakdown by epic.
 * Only considers active (non-superseded) derived entries.
 */
export async function getInitiativeCogsSummary(tenantId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, tenantId, isInitiative: true },
    select: { id: true, name: true, status: true }
  });
  if (!project) return null;

  const entries = await prisma.cogsEntry.findMany({
    where: {
      tenantId,
      projectId,
      isDerived: true,
      supersededAt: null
    },
    select: {
      totalCost: true,
      hoursWorked: true,
      category: true,
      subcategory: true,
      epicId: true,
      confidence: true
    }
  });

  const totalCost    = sumCost(entries);
  const totalHours   = Math.round(entries.reduce((s, e) => s + e.hoursWorked, 0) * 100) / 100;

  const deliveryEntries = entries.filter((e) => e.category === 'engineering');
  const wasteEntries    = entries.filter((e) => e.subcategory === 'cancelled_task');

  const deliveryCost = sumCost(deliveryEntries);
  const wasteCost    = sumCost(wasteEntries);
  const deliveryHours = Math.round(deliveryEntries.reduce((s, e) => s + e.hoursWorked, 0) * 100) / 100;
  const wasteHours    = Math.round(wasteEntries.reduce((s, e) => s + e.hoursWorked, 0) * 100) / 100;

  // Breakdown by epic
  const epicMap: Record<string, { total_cost: number; hours: number; delivery_cost: number; waste_cost: number }> = {};
  for (const e of entries) {
    const key = e.epicId ?? '__project';
    if (!epicMap[key]) epicMap[key] = { total_cost: 0, hours: 0, delivery_cost: 0, waste_cost: 0 };
    epicMap[key].total_cost   = Math.round((epicMap[key].total_cost + e.totalCost) * 100) / 100;
    epicMap[key].hours        = Math.round((epicMap[key].hours + e.hoursWorked) * 100) / 100;
    if (e.category === 'engineering') {
      epicMap[key].delivery_cost = Math.round((epicMap[key].delivery_cost + e.totalCost) * 100) / 100;
    } else if (e.subcategory === 'cancelled_task') {
      epicMap[key].waste_cost = Math.round((epicMap[key].waste_cost + e.totalCost) * 100) / 100;
    }
  }

  // Confidence distribution
  const confidenceDist: Record<string, number> = {};
  for (const e of entries) {
    confidenceDist[e.confidence] = (confidenceDist[e.confidence] ?? 0) + 1;
  }

  return {
    project_id: projectId,
    project_name: project.name,
    project_status: project.status,
    total_cost: totalCost,
    delivery_cost: deliveryCost,
    waste_cost: wasteCost,
    waste_percent: totalCost > 0 ? Math.round((wasteCost / totalCost) * 10000) / 100 : 0,
    total_hours: totalHours,
    delivery_hours: deliveryHours,
    waste_hours: wasteHours,
    entry_count: entries.length,
    confidence_distribution: confidenceDist,
    by_epic: epicMap
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePeriod(period: string): { dateFrom: Date; dateTo: Date } {
  // "2026-Q2" → Apr–Jun 2026
  const quarterMatch = period.match(/^(\d{4})-Q([1-4])$/);
  if (quarterMatch) {
    const year = parseInt(quarterMatch[1], 10);
    const q = parseInt(quarterMatch[2], 10);
    const monthStart = (q - 1) * 3; // 0, 3, 6, 9
    const dateFrom = new Date(year, monthStart, 1);
    const dateTo = new Date(year, monthStart + 3, 0); // last day of last month of quarter
    return { dateFrom, dateTo };
  }
  // "2026-04" → April 2026
  const monthMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const year = parseInt(monthMatch[1], 10);
    const month = parseInt(monthMatch[2], 10) - 1; // 0-indexed
    const dateFrom = new Date(year, month, 1);
    const dateTo = new Date(year, month + 1, 0);
    return { dateFrom, dateTo };
  }
  throw new Error('INVALID_PERIOD');
}
