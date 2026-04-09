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
  computeRoi
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

export async function listCogsEntries(tenantId: string, query: ListCogsEntriesQuery) {
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
