import { prisma } from '../../lib/prisma.js';
import {
  forecastVelocity,
  forecastEpicCompletion,
  computeSlaRiskScore,
  detectAnomalies,
  generateRecommendations,
  computeCapacityUtilization,
  buildGanttEpicItem,
  computeDependencyStatuses,
  computeWorkMixSignal,
  computeEstimationBias,
  computeKeyPersonRiskLevel,
  computeTeamHealthDimensionLevel,
  computeTeamOverallLevel,
  computeLinearRegression,
  computePercentile,
  type WeeklyPoint,
  type RecommendationSignals,
  type DependencyEdge,
  type DependencyNode
} from './engine.js';
import type { z } from 'zod';
import type {
  velocityForecastQuerySchema,
  epicForecastParamsSchema,
  slaRiskQuerySchema,
  anomaliesQuerySchema,
  recommendationsQuerySchema,
  capacityQuerySchema,
  roadmapQuerySchema,
  dependencyQuerySchema,
  exportQuerySchema,
  onTimeDeliveryQuerySchema,
  workMixQuerySchema,
  reworkRateQuerySchema,
  estimationAccuracyQuerySchema,
  keyPersonRiskQuerySchema,
  teamHealthQuerySchema,
  incidentPatternsQuerySchema,
  deployQualityQuerySchema,
  slaSuggestionsQuerySchema,
  trendDegradationQuerySchema
} from './schema.js';

type VelocityQuery      = z.infer<typeof velocityForecastQuerySchema>;
type EpicForecastParams = z.infer<typeof epicForecastParamsSchema>;
type SlaRiskQuery       = z.infer<typeof slaRiskQuerySchema>;
type AnomaliesQuery     = z.infer<typeof anomaliesQuerySchema>;
type RecommendQuery     = z.infer<typeof recommendationsQuerySchema>;
type CapacityQuery      = z.infer<typeof capacityQuerySchema>;
type RoadmapQuery       = z.infer<typeof roadmapQuerySchema>;
type DependencyQuery    = z.infer<typeof dependencyQuerySchema>;
type ExportQuery        = z.infer<typeof exportQuerySchema>;
type OnTimeDeliveryQuery     = z.infer<typeof onTimeDeliveryQuerySchema>;
type WorkMixQuery            = z.infer<typeof workMixQuerySchema>;
type ReworkRateQuery         = z.infer<typeof reworkRateQuerySchema>;
type EstimationAccuracyQuery = z.infer<typeof estimationAccuracyQuerySchema>;
type KeyPersonRiskQuery      = z.infer<typeof keyPersonRiskQuerySchema>;
type TeamHealthQuery         = z.infer<typeof teamHealthQuerySchema>;
type IncidentPatternsQuery   = z.infer<typeof incidentPatternsQuerySchema>;
type DeployQualityQuery      = z.infer<typeof deployQualityQuerySchema>;
type SlaSuggestionsQuery     = z.infer<typeof slaSuggestionsQuerySchema>;
type TrendDegradationQuery   = z.infer<typeof trendDegradationQuerySchema>;

// ── Internal: ISO week start (Monday) ─────────────────────────────────────────

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 = Sun
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

// ── Internal: period → date range (reuses cogs parsePeriod logic) ─────────────

function resolvePeriodAlias(period: string): string {
  const now = new Date();
  switch (period) {
    case 'current_quarter': return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
    case 'current_month':   return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    case 'last_quarter':    return previousPeriod(now);
    case 'last_month': {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    default: return period;
  }
}

/** last_N_quarters: N completed quarters before the current one. */
function lastNQuarters(n: number, now = new Date()): { dateFrom: Date; dateTo: Date } {
  const currentQ = Math.floor(now.getMonth() / 3); // 0-based (0..3)
  let endQ    = currentQ - 1;
  let endYear = now.getFullYear();
  if (endQ < 0) { endQ = 3; endYear -= 1; }

  let startQ    = endQ - (n - 1);
  let startYear = endYear;
  while (startQ < 0) { startQ += 4; startYear -= 1; }

  return {
    dateFrom: new Date(startYear, startQ * 3, 1),
    dateTo:   new Date(endYear, (endQ + 1) * 3, 0)
  };
}

function parsePeriod(raw: string): { dateFrom: Date; dateTo: Date } {
  // Handle last_N_quarters before string alias resolution
  const lastQm = raw.match(/^last_(\d+)_quarters?$/);
  if (lastQm) return lastNQuarters(parseInt(lastQm[1], 10));

  const period = resolvePeriodAlias(raw);
  const qm = period.match(/^(\d{4})-Q([1-4])$/);
  if (qm) {
    const year = parseInt(qm[1], 10);
    const monthStart = (parseInt(qm[2], 10) - 1) * 3;
    return { dateFrom: new Date(year, monthStart, 1), dateTo: new Date(year, monthStart + 3, 0) };
  }
  const mm = period.match(/^(\d{4})-(\d{2})$/);
  if (mm) {
    const year = parseInt(mm[1], 10);
    const month = parseInt(mm[2], 10) - 1;
    return { dateFrom: new Date(year, month, 1), dateTo: new Date(year, month + 1, 0) };
  }
  throw new Error('INVALID_PERIOD');
}

/** Returns YYYY-Qn string for the quarter containing `now`. */
function currentPeriod(now = new Date()): string {
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
}

/** Returns YYYY-MM string for the previous quarter relative to `now`. */
function previousPeriod(now = new Date()): string {
  const month = now.getMonth();
  const year  = now.getFullYear();
  const q     = Math.floor(month / 3);
  if (q === 0) return `${year - 1}-Q4`;
  return `${year}-Q${q}`;
}

/** Returns date range for the last N months (exclusive of today midnight). */
function lastNMonths(n: number, now = new Date()): { dateFrom: Date; dateTo: Date } {
  const dateTo   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateFrom = new Date(dateTo);
  dateFrom.setMonth(dateFrom.getMonth() - n);
  return { dateFrom, dateTo };
}

/** Returns date range for the last N days (exclusive of today midnight). */
function lastNDays(n: number, now = new Date()): { dateFrom: Date; dateTo: Date } {
  const dateTo   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateFrom = new Date(dateTo);
  dateFrom.setDate(dateFrom.getDate() - n);
  return { dateFrom, dateTo };
}

// ── Velocity forecast ─────────────────────────────────────────────────────────

export async function getVelocityForecast(tenantId: string, query: VelocityQuery) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - query.window_weeks * 7);

  const tasks = await prisma.task.findMany({
    where: {
      tenantId,
      status: 'done',
      storyPoints: { gt: 0 },
      completedAt: { gte: cutoff },
      ...(query.project_id && { projectId: query.project_id }),
      ...(query.team_id && { project: { teamId: query.team_id } })
    },
    select: { storyPoints: true, completedAt: true }
  });

  // Group by ISO week start
  const buckets = new Map<string, number>();
  for (const t of tasks) {
    if (!t.completedAt || !t.storyPoints) continue;
    const week = getWeekStart(t.completedAt);
    buckets.set(week, (buckets.get(week) ?? 0) + t.storyPoints);
  }

  // Fill missing weeks with 0 for continuity
  const allWeeks: WeeklyPoint[] = [];
  for (let w = 0; w < query.window_weeks; w++) {
    const d = new Date(cutoff);
    d.setDate(d.getDate() + w * 7);
    const week = getWeekStart(d);
    allWeeks.push({ weekStart: week, points: buckets.get(week) ?? 0 });
  }

  // Drop trailing zero weeks only at the end (might be future weeks)
  while (allWeeks.length > 1 && allWeeks[allWeeks.length - 1].points === 0) {
    allWeeks.pop();
  }

  const forecast = forecastVelocity(allWeeks);

  return {
    project_id: query.project_id ?? null,
    team_id: query.team_id ?? null,
    window_weeks: query.window_weeks,
    ...forecast
  };
}

// ── Epic completion forecast ───────────────────────────────────────────────────

export async function getEpicCompletionForecast(tenantId: string, params: EpicForecastParams) {
  const epic = await prisma.epic.findFirst({
    where: { id: params.epic_id, tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      targetEndDate: true,
      projectId: true,
      tasks: {
        where: { status: { not: 'done' }, storyPoints: { gt: 0 } },
        select: { storyPoints: true }
      }
    }
  });

  if (!epic) return null;

  const remainingPoints = epic.tasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);

  // Velocity from last 12 weeks on the same project
  const velocityResult = await getVelocityForecast(tenantId, {
    project_id: epic.projectId,
    window_weeks: 12
  });

  const completionForecast = forecastEpicCompletion(
    remainingPoints,
    velocityResult.forecastedPointsPerWeek,
    new Date()
  );

  // Detect delay vs target
  let weeksOverdue: number | null = null;
  if (completionForecast && epic.targetEndDate) {
    const target = new Date(epic.targetEndDate);
    const estimated = new Date(completionForecast.estimatedEndDate);
    const diffMs = estimated.getTime() - target.getTime();
    weeksOverdue = diffMs > 0 ? Math.ceil(diffMs / (7 * 24 * 3_600_000)) : 0;
  }

  return {
    epic_id: epic.id,
    epic_name: epic.name,
    status: epic.status,
    target_end_date: epic.targetEndDate?.toISOString().split('T')[0] ?? null,
    remaining_points: remainingPoints,
    velocity_forecast: {
      forecasted_points_per_week: velocityResult.forecastedPointsPerWeek,
      trend: velocityResult.trend,
      confidence_score: velocityResult.confidenceScore
    },
    completion_forecast: completionForecast,
    weeks_overdue: weeksOverdue
  };
}

// ── SLA risk ──────────────────────────────────────────────────────────────────
// SLA instances no longer exist — risk is approximated from active tasks.
// Tasks with startedAt are sorted by age; dueDate is used as deadline when available.

export async function getSlaRisk(tenantId: string, query: SlaRiskQuery) {
  const tasks = await prisma.task.findMany({
    where: {
      tenantId,
      status: { in: ['in_progress', 'review'] },
      startedAt: { not: null },
      ...(query.project_id && { projectId: query.project_id }),
      ...(query.team_id && { project: { teamId: query.team_id } })
    },
    select: {
      id: true,
      title: true,
      priority: true,
      projectId: true,
      epicId: true,
      assigneeId: true,
      startedAt: true,
      dueDate: true
    },
    orderBy: { startedAt: 'asc' },
    take: query.limit
  });

  const now = new Date();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  return tasks.map(task => {
    const startedAt = task.startedAt!;
    const deadlineAt = task.dueDate ?? new Date(startedAt.getTime() + SEVEN_DAYS_MS);
    const risk = computeSlaRiskScore(task.id, task.id, startedAt, deadlineAt, now);
    return {
      ...risk,
      task_title: task.title,
      priority: task.priority,
      project_id: task.projectId,
      epic_id: task.epicId,
      assignee_id: task.assigneeId,
      minutes_remaining: Math.round((deadlineAt.getTime() - now.getTime()) / 60_000)
    };
  });
}

// ── Anomaly detection ─────────────────────────────────────────────────────────

export async function getAnomalies(tenantId: string, query: AnomaliesQuery) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - query.window_days);

  const metrics = await prisma.healthMetric.findMany({
    where: {
      tenantId,
      computedAt: { gte: cutoff },
      ...(query.metric_name && { metricName: query.metric_name }),
      ...(query.project_id && { projectId: query.project_id })
    },
    orderBy: { computedAt: 'asc' }
  });

  // Group series by metricName (and optionally projectId)
  const seriesMap = new Map<string, Array<{ date: string; value: number }>>();
  for (const m of metrics) {
    const key = `${m.metricName}::${m.projectId ?? '_'}`;
    const list = seriesMap.get(key) ?? [];
    list.push({ date: m.computedAt.toISOString().split('T')[0], value: m.value });
    seriesMap.set(key, list);
  }

  const result: Array<{
    metric_name: string;
    project_id: string | null;
    anomalies: ReturnType<typeof detectAnomalies>;
  }> = [];

  for (const [key, series] of seriesMap) {
    const [metricName, projectIdKey] = key.split('::');
    const anomalies = detectAnomalies(series, query.z_threshold);
    if (anomalies.length > 0) {
      result.push({
        metric_name: metricName,
        project_id: projectIdKey === '_' ? null : projectIdKey,
        anomalies
      });
    }
  }

  return result;
}

// ── Recommendations ───────────────────────────────────────────────────────────

export async function getRecommendations(tenantId: string, query: RecommendQuery) {
  const signals: RecommendationSignals = {};

  // DORA level: latest overall scorecard metric
  const doraSig = await prisma.healthMetric.findFirst({
    where: { tenantId, metricName: 'dora_overall', ...(query.project_id && { projectId: query.project_id }) },
    orderBy: { computedAt: 'desc' },
    select: { level: true }
  });
  if (doraSig?.level) {
    signals.doraOverallLevel = doraSig.level as RecommendationSignals['doraOverallLevel'];
  }

  // SLA counts: derived from active tasks (in_progress/review) as a proxy
  const slaRiskTasks = await prisma.task.findMany({
    where: {
      tenantId,
      status: { in: ['in_progress', 'review'] },
      startedAt: { not: null },
      ...(query.project_id || query.team_id
        ? {
            ...(query.project_id && { projectId: query.project_id }),
            ...(query.team_id && { project: { teamId: query.team_id } })
          }
        : {})
    },
    select: { startedAt: true, dueDate: true }
  });
  const now2 = new Date();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  let atRiskCount = 0, breachedCount = 0;
  for (const t of slaRiskTasks) {
    const startedAt = t.startedAt!;
    const deadlineAt = t.dueDate ?? new Date(startedAt.getTime() + SEVEN_DAYS_MS);
    const elapsedMs = now2.getTime() - startedAt.getTime();
    const totalMs = deadlineAt.getTime() - startedAt.getTime();
    const pct = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 100;
    if (now2 > deadlineAt) breachedCount++;
    else if (pct >= 80) atRiskCount++;
  }
  signals.atRiskSlaCount = atRiskCount;
  signals.breachedSlaCount = breachedCount;

  // Velocity trend
  const velocityResult = await getVelocityForecast(tenantId, {
    project_id: query.project_id,
    team_id: query.team_id,
    window_weeks: 12
  });
  signals.velocityTrend = velocityResult.trend;

  // COGS burn rate: find most recent budget + entries for current month
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  try {
    const { dateFrom, dateTo } = parsePeriod(currentPeriod);
    const [entriesAgg, budgets] = await Promise.all([
      prisma.cogsEntry.aggregate({
        where: {
          tenantId,
          periodDate: { gte: dateFrom, lte: dateTo },
          ...(query.project_id && { projectId: query.project_id }),
          ...(query.team_id && { teamId: query.team_id })
        },
        _sum: { totalCost: true }
      }),
      prisma.cogsBudget.findMany({
        where: {
          tenantId,
          period: currentPeriod,
          ...(query.project_id ? { projectId: query.project_id } : {}),
          ...(query.team_id ? { teamId: query.team_id } : {})
        },
        select: { budgetAmount: true }
      })
    ]);

    const actual = entriesAgg._sum.totalCost ?? 0;
    const budget = budgets.reduce((s, b) => s + b.budgetAmount, 0);
    if (budget > 0) {
      const pct = (actual / budget) * 100;
      signals.burnStatus = pct > 100 ? 'over_budget' : pct >= 90 ? 'at_risk' : 'on_track';
    }
  } catch {
    // No budget data — skip
  }

  // Delayed epics: epics with targetEndDate passed + still active
  const delayedEpics = await prisma.epic.findMany({
    where: {
      tenantId,
      status: 'active',
      targetEndDate: { lt: new Date() },
      ...(query.project_id && { projectId: query.project_id })
    },
    select: { id: true, name: true, targetEndDate: true },
    take: 5
  });

  signals.delayedEpics = delayedEpics.map(e => ({
    epicId: e.id,
    epicName: e.name,
    weeksOverdue: Math.ceil(
      (new Date().getTime() - e.targetEndDate!.getTime()) / (7 * 24 * 3_600_000)
    )
  }));

  return generateRecommendations(signals);
}

// ── Capacity utilization ──────────────────────────────────────────────────────

export async function getCapacity(tenantId: string, query: CapacityQuery) {
  const { dateFrom, dateTo } = parsePeriod(query.period);

  const entries = await prisma.cogsEntry.findMany({
    where: {
      tenantId,
      periodDate: { gte: dateFrom, lte: dateTo },
      userId: { not: null },
      ...(query.team_id && { teamId: query.team_id })
    },
    select: { userId: true, hoursWorked: true }
  });

  // Aggregate hours per user
  const userMap = new Map<string, number>();
  for (const e of entries) {
    if (!e.userId) continue;
    userMap.set(e.userId, (userMap.get(e.userId) ?? 0) + e.hoursWorked);
  }

  const aggregated = Array.from(userMap.entries()).map(([userId, hoursWorked]) => ({
    userId,
    hoursWorked
  }));

  const utilization = computeCapacityUtilization(aggregated, query.capacity_hours);

  const overloaded = utilization.filter(u => u.status === 'over').map(u => u.userId);
  const totalLogged = round2(utilization.reduce((s, u) => s + u.hoursWorked, 0));
  const totalCapacity = round2(utilization.length * query.capacity_hours);

  return {
    period: query.period,
    team_id: query.team_id ?? null,
    capacity_hours_per_person: query.capacity_hours,
    total_users: utilization.length,
    total_capacity_hours: totalCapacity,
    total_logged_hours: totalLogged,
    overloaded_count: overloaded.length,
    utilization
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Roadmap / Gantt (4.6) ─────────────────────────────────────────────────────

export async function getRoadmap(tenantId: string, query: RoadmapQuery) {
  const projects = await prisma.project.findMany({
    where: {
      tenantId,
      ...(query.project_id && { id: query.project_id }),
      ...(query.team_id && { teamId: query.team_id })
    },
    select: {
      id: true,
      key: true,
      name: true,
      status: true,
      startDate: true,
      targetEndDate: true,
      epics: {
        where: {
          ...(query.status ? { status: query.status } : { status: { not: 'cancelled' } })
        },
        select: {
          id: true,
          name: true,
          status: true,
          startDate: true,
          targetEndDate: true,
          totalStoryPoints: true,
          completedTasks: true,
          totalTasks: true,
          tasks: {
            where: { status: { not: 'done' }, storyPoints: { gt: 0 } },
            select: { storyPoints: true }
          }
        },
        orderBy: { startDate: 'asc' }
      }
    },
    orderBy: { startDate: 'asc' }
  });

  const result = [];
  for (const project of projects) {
    // Get velocity for this project (12-week window)
    const velocityResult = await getVelocityForecast(tenantId, {
      project_id: project.id,
      window_weeks: 12
    });

    const epicItems = project.epics.map(epic => {
      const remainingStoryPoints = epic.tasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
      return buildGanttEpicItem({
        epicId: epic.id,
        epicName: epic.name,
        epicStatus: epic.status,
        startDate: epic.startDate,
        targetEndDate: epic.targetEndDate,
        totalStoryPoints: epic.totalStoryPoints,
        completedTasks: epic.completedTasks,
        totalTasks: epic.totalTasks,
        remainingStoryPoints,
        velocityPerWeek: velocityResult.forecastedPointsPerWeek,
        confidenceScore: velocityResult.confidenceScore
      });
    });

    result.push({
      project_id: project.id,
      project_name: project.name,
      project_key: project.key,
      status: project.status,
      start_date: project.startDate ? project.startDate.toISOString().split('T')[0] : null,
      target_end_date: project.targetEndDate ? project.targetEndDate.toISOString().split('T')[0] : null,
      velocity_forecast: {
        forecasted_points_per_week: velocityResult.forecastedPointsPerWeek,
        trend: velocityResult.trend,
        confidence_score: velocityResult.confidenceScore
      },
      epics: epicItems
    });
  }

  return result;
}

// ── Dependency graph (4.7) ────────────────────────────────────────────────────

export async function getDependencies(tenantId: string, query: DependencyQuery) {
  const deps = await prisma.taskDependency.findMany({
    where: {
      tenantId,
      ...(query.project_id && {
        OR: [
          { blocker: { projectId: query.project_id } },
          { blocked: { projectId: query.project_id } }
        ]
      }),
      ...(query.epic_id && {
        OR: [
          { blocker: { epicId: query.epic_id } },
          { blocked: { epicId: query.epic_id } }
        ]
      })
    },
    select: {
      blockerId: true,
      blockedId: true,
      blocker: {
        select: {
          id: true,
          title: true,
          status: true,
          epicId: true,
          assigneeId: true,
          storyPoints: true,
          dueDate: true
        }
      },
      blocked: {
        select: {
          id: true,
          title: true,
          status: true,
          epicId: true,
          assigneeId: true,
          storyPoints: true,
          dueDate: true
        }
      }
    }
  });

  // Collect unique tasks
  const taskMap = new Map<string, typeof deps[0]['blocker']>();
  for (const d of deps) {
    taskMap.set(d.blockerId, d.blocker);
    taskMap.set(d.blockedId, d.blocked);
  }

  const edges: DependencyEdge[] = deps.map(d => ({
    blocker_id: d.blockerId,
    blocked_id: d.blockedId
  }));

  const taskList = Array.from(taskMap.values()).map(t => ({
    taskId: t.id,
    status: t.status
  }));

  const statusMap = computeDependencyStatuses(taskList, edges);

  const nodes: DependencyNode[] = Array.from(taskMap.values()).map(t => ({
    task_id: t.id,
    task_title: t.title,
    status: t.status,
    dependency_status: statusMap.get(t.id)!,
    epic_id: t.epicId,
    assignee_id: t.assigneeId,
    story_points: t.storyPoints,
    due_date: t.dueDate ? t.dueDate.toISOString().split('T')[0] : null
  }));

  return { nodes, edges };
}

// ── CSV/BI Export (4.10) ──────────────────────────────────────────────────────

function toCsvRow(obj: Record<string, unknown>): string {
  return Object.values(obj)
    .map(v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  return [headers.join(','), ...rows.map(r => toCsvRow(r))].join('\n');
}

export async function getExport(tenantId: string, query: ExportQuery): Promise<string> {
  switch (query.type) {
    case 'tasks': {
      const tasks = await prisma.task.findMany({
        where: {
          tenantId,
          ...(query.project_id && { projectId: query.project_id }),
          ...(query.team_id && { project: { teamId: query.team_id } })
        },
        select: {
          id: true, title: true, taskType: true, priority: true, status: true,
          epicId: true, projectId: true, assigneeId: true, storyPoints: true,
          hoursEstimated: true, hoursActual: true, startedAt: true,
          completedAt: true, dueDate: true, cycleTimeHours: true, createdAt: true
        },
        orderBy: { createdAt: 'asc' }
      });
      return toCsv(
        ['id', 'title', 'task_type', 'priority', 'status', 'epic_id', 'project_id',
         'assignee_id', 'story_points', 'hours_estimated', 'hours_actual',
         'started_at', 'completed_at', 'due_date', 'cycle_time_hours', 'created_at'],
        tasks.map(t => ({
          id: t.id, title: t.title, task_type: t.taskType, priority: t.priority,
          status: t.status, epic_id: t.epicId, project_id: t.projectId,
          assignee_id: t.assigneeId, story_points: t.storyPoints,
          hours_estimated: t.hoursEstimated, hours_actual: t.hoursActual,
          started_at: t.startedAt?.toISOString(), completed_at: t.completedAt?.toISOString(),
          due_date: t.dueDate?.toISOString(), cycle_time_hours: t.cycleTimeHours,
          created_at: t.createdAt.toISOString()
        }))
      );
    }

    case 'epics': {
      const epics = await prisma.epic.findMany({
        where: {
          tenantId,
          ...(query.project_id && { projectId: query.project_id })
        },
        select: {
          id: true, name: true, status: true, projectId: true, ownerId: true,
          startDate: true, targetEndDate: true, actualEndDate: true,
          totalTasks: true, completedTasks: true, totalStoryPoints: true,
          actualHours: true, healthScore: true, createdAt: true
        },
        orderBy: { createdAt: 'asc' }
      });
      return toCsv(
        ['id', 'name', 'status', 'project_id', 'owner_id', 'start_date',
         'target_end_date', 'actual_end_date', 'total_tasks', 'completed_tasks',
         'total_story_points', 'actual_hours', 'health_score', 'created_at'],
        epics.map(e => ({
          id: e.id, name: e.name, status: e.status, project_id: e.projectId,
          owner_id: e.ownerId, start_date: e.startDate?.toISOString(),
          target_end_date: e.targetEndDate?.toISOString(),
          actual_end_date: e.actualEndDate?.toISOString(),
          total_tasks: e.totalTasks, completed_tasks: e.completedTasks,
          total_story_points: e.totalStoryPoints, actual_hours: e.actualHours,
          health_score: e.healthScore, created_at: e.createdAt.toISOString()
        }))
      );
    }

    case 'velocity': {
      const result = await getVelocityForecast(tenantId, {
        project_id: query.project_id,
        team_id: query.team_id,
        window_weeks: 12
      });
      return toCsv(
        ['week_start', 'points', 'forecasted_points_per_week', 'trend', 'confidence_score'],
        result.weeklyHistory.map((w, i) => ({
          week_start: w.weekStart,
          points: w.points,
          forecasted_points_per_week: i === result.weeklyHistory.length - 1
            ? result.forecastedPointsPerWeek : '',
          trend: i === result.weeklyHistory.length - 1 ? result.trend : '',
          confidence_score: i === result.weeklyHistory.length - 1 ? result.confidenceScore : ''
        }))
      );
    }

    case 'capacity': {
      if (!query.period) throw new Error('period is required for capacity export');
      const result = await getCapacity(tenantId, { period: query.period, team_id: query.team_id, capacity_hours: 160 });
      return toCsv(
        ['user_id', 'hours_worked', 'capacity_hours', 'utilization_percent', 'status'],
        result.utilization.map(u => ({
          user_id: u.userId, hours_worked: u.hoursWorked,
          capacity_hours: u.capacityHours, utilization_percent: u.utilizationPercent,
          status: u.status
        }))
      );
    }

    case 'anomalies': {
      const result = await getAnomalies(tenantId, {
        project_id: query.project_id,
        window_days: 90,
        z_threshold: 2.0
      });
      const rows: Record<string, unknown>[] = [];
      for (const group of result) {
        for (const a of group.anomalies) {
          rows.push({
            metric_name: group.metric_name,
            project_id: group.project_id,
            date: a.date, value: a.value,
            z_score: a.zScore, direction: a.direction
          });
        }
      }
      return toCsv(
        ['metric_name', 'project_id', 'date', 'value', 'z_score', 'direction'],
        rows
      );
    }
  }
}

// ── v2.1: On-time delivery ────────────────────────────────────────────────────

export async function getOnTimeDelivery(tenantId: string, query: OnTimeDeliveryQuery) {
  const period = query.period ?? currentPeriod();
  const { dateFrom, dateTo } = parsePeriod(period);

  const baseWhere = {
    tenantId,
    status: 'done' as const,
    completedAt: { gte: dateFrom, lte: dateTo },
    ...(query.project_id && { projectId: query.project_id }),
    ...(query.team_id    && { project: { teamId: query.team_id } }),
    ...(query.priority   && { priority: query.priority as never }),
    ...(query.task_type  && { taskType: query.task_type as never })
  };

  const [tasks, totalCompleted] = await Promise.all([
    prisma.task.findMany({
      where: { ...baseWhere, dueDate: { not: null } },
      select: { id: true, completedAt: true, dueDate: true, priority: true, taskType: true }
    }),
    prisma.task.count({ where: baseWhere })
  ]);

  const onTimeTasks = tasks.filter(t => t.completedAt! <= t.dueDate!);
  const onTimeRate  = tasks.length > 0 ? round2((onTimeTasks.length / tasks.length) * 100) : 0;
  const coveragePct = totalCompleted > 0 ? round2((tasks.length / totalCompleted) * 100) : 0;

  // breakdown by priority
  const byPriority = new Map<string, { total: number; onTime: number }>();
  for (const t of tasks) {
    const p = t.priority as string;
    const e = byPriority.get(p) ?? { total: 0, onTime: 0 };
    e.total++;
    if (t.completedAt! <= t.dueDate!) e.onTime++;
    byPriority.set(p, e);
  }

  // breakdown by type
  const byType = new Map<string, { total: number; onTime: number }>();
  for (const t of tasks) {
    const type = (t.taskType as string) ?? 'untyped';
    const e = byType.get(type) ?? { total: 0, onTime: 0 };
    e.total++;
    if (t.completedAt! <= t.dueDate!) e.onTime++;
    byType.set(type, e);
  }

  // comparison period
  let comparison = null;
  if (query.compare_period) {
    const { dateFrom: cf, dateTo: ct } = parsePeriod(query.compare_period);
    const priorTasks = await prisma.task.findMany({
      where: {
        tenantId, status: 'done', dueDate: { not: null },
        completedAt: { gte: cf, lte: ct },
        ...(query.project_id && { projectId: query.project_id }),
        ...(query.team_id    && { project: { teamId: query.team_id } })
      },
      select: { completedAt: true, dueDate: true }
    });
    const priorOnTime = priorTasks.filter(t => t.completedAt! <= t.dueDate!);
    const priorRate   = priorTasks.length > 0 ? round2((priorOnTime.length / priorTasks.length) * 100) : 0;
    const deltaPp     = round2(onTimeRate - priorRate);
    comparison = {
      period: query.compare_period,
      on_time_rate_percent: priorRate,
      delta_pp: deltaPp,
      trend: deltaPp > 5 ? 'improving' : deltaPp < -5 ? 'declining' : 'stable'
    };
  }

  return {
    period,
    project_id:                 query.project_id ?? null,
    team_id:                    query.team_id ?? null,
    on_time_rate_percent:       onTimeRate,
    coverage_percent:           coveragePct,
    total_tasks_with_due_date:  tasks.length,
    delivered_on_time:          onTimeTasks.length,
    delivered_late:             tasks.length - onTimeTasks.length,
    low_sample:                 tasks.length < 10,
    comparison,
    breakdown_by_priority: Array.from(byPriority.entries())
      .map(([priority, { total, onTime }]) => ({
        priority,
        on_time_rate_percent: total > 0 ? round2((onTime / total) * 100) : 0,
        total
      }))
      .sort((a, b) => a.priority.localeCompare(b.priority)),
    breakdown_by_type: Array.from(byType.entries())
      .map(([task_type, { total, onTime }]) => ({
        task_type,
        on_time_rate_percent: total > 0 ? round2((onTime / total) * 100) : 0,
        total
      }))
      .sort((a, b) => a.task_type.localeCompare(b.task_type))
  };
}

// ── v2.2: Work mix ────────────────────────────────────────────────────────────

export async function getWorkMix(tenantId: string, query: WorkMixQuery) {
  const period        = query.period        ?? currentPeriod();
  const comparePeriod = query.compare_period ?? previousPeriod();
  const { dateFrom, dateTo } = parsePeriod(period);
  const { dateFrom: cf, dateTo: ct } = parsePeriod(comparePeriod);

  const [current, prior] = await Promise.all([
    prisma.task.groupBy({
      by: ['taskType'],
      where: {
        tenantId, status: 'done',
        completedAt: { gte: dateFrom, lte: dateTo },
        ...(query.project_id && { projectId: query.project_id }),
        ...(query.team_id    && { project: { teamId: query.team_id } })
      },
      _count: { taskType: true }
    }),
    prisma.task.groupBy({
      by: ['taskType'],
      where: {
        tenantId, status: 'done',
        completedAt: { gte: cf, lte: ct },
        ...(query.project_id && { projectId: query.project_id }),
        ...(query.team_id    && { project: { teamId: query.team_id } })
      },
      _count: { taskType: true }
    })
  ]);

  const typed     = current.filter(r => r.taskType !== null);
  const untyped   = current.find(r => r.taskType === null)?._count.taskType ?? 0;
  const totalTyped = typed.reduce((s, r) => s + r._count.taskType, 0);

  const priorMap  = new Map(prior.filter(r => r.taskType !== null).map(r => [r.taskType as string, r._count.taskType]));
  const priorTotal = prior.filter(r => r.taskType !== null).reduce((s, r) => s + r._count.taskType, 0);

  const mix = typed.map(r => {
    const type    = r.taskType as string;
    const count   = r._count.taskType;
    const pct     = totalTyped > 0 ? round2((count / totalTyped) * 100) : 0;
    const priorCnt = priorMap.get(type) ?? 0;
    const priorPct = priorTotal > 0 ? round2((priorCnt / priorTotal) * 100) : 0;
    const deltaPp  = query.compare_period !== null ? round2(pct - priorPct) : null;
    return {
      task_type: type,
      count,
      percent: pct,
      delta_pp: deltaPp,
      signal: computeWorkMixSignal(type, deltaPp)
    };
  }).sort((a, b) => b.count - a.count);

  const alerts: Array<{ level: string; message: string }> = [];
  for (const item of mix) {
    if (item.signal === 'alert') {
      const sign = (item.delta_pp ?? 0) >= 0 ? '+' : '';
      alerts.push({
        level: 'warning',
        message: `${item.task_type === 'bug' ? 'Bugs' : 'Tech debt'} representam ${item.percent}% do trabalho entregue (${sign}${item.delta_pp}pp vs período anterior). Pode indicar queda de qualidade.`
      });
    } else if (item.signal === 'decline') {
      alerts.push({
        level: 'warning',
        message: `Features representam ${item.percent}% do trabalho entregue (${item.delta_pp}pp vs período anterior). Pode indicar bloqueio de novas entregas.`
      });
    }
  }

  return {
    period,
    compare_period:         comparePeriod,
    project_id:             query.project_id ?? null,
    team_id:                query.team_id ?? null,
    total_delivered:        totalTyped,
    untyped_excluded_count: untyped,
    mix,
    alerts
  };
}

// ── v2.3: Rework rate ─────────────────────────────────────────────────────────

export async function getReworkRate(tenantId: string, query: ReworkRateQuery) {
  const period = query.period ?? currentPeriod();
  const { dateFrom, dateTo } = parsePeriod(period);

  const baseWhere = {
    tenantId, status: 'done' as const,
    completedAt: { gte: dateFrom, lte: dateTo },
    ...(query.project_id && { projectId: query.project_id }),
    ...(query.team_id    && { project: { teamId: query.team_id } })
  };

  const [completedTasks, allReworkEntries] = await Promise.all([
    prisma.task.findMany({
      where: baseWhere,
      select: { id: true, taskType: true, title: true, assigneeId: true }
    }),
    prisma.cogsEntry.findMany({
      where: { tenantId, revision: { gt: 1 } },
      select: { taskId: true, revision: true, totalCost: true, hoursWorked: true }
    })
  ]);

  const totalCompleted = completedTasks.length;
  const taskMeta       = new Map(completedTasks.map(t => [t.id, { taskType: t.taskType, title: t.title, assigneeId: t.assigneeId }]));
  const taskIds        = new Set(completedTasks.map(t => t.id));

  // Only rework entries that relate to tasks in our period/scope
  const reworkEntries = allReworkEntries.filter(e => e.taskId && taskIds.has(e.taskId));

  // Aggregate by taskId
  const taskMap = new Map<string, {
    taskId: string; revisions: number; cost: number; hours: number;
    taskType: string | null; title: string; assigneeId: string | null;
  }>();
  for (const e of reworkEntries) {
    if (!e.taskId) continue;
    const meta     = taskMeta.get(e.taskId);
    const existing = taskMap.get(e.taskId);
    if (existing) {
      existing.revisions = Math.max(existing.revisions, e.revision);
      existing.cost  += e.totalCost;
      existing.hours += e.hoursWorked;
    } else {
      taskMap.set(e.taskId, {
        taskId:     e.taskId,
        revisions:  e.revision,
        cost:       e.totalCost,
        hours:      e.hoursWorked,
        taskType:   meta?.taskType ?? null,
        title:      meta?.title ?? '',
        assigneeId: meta?.assigneeId ?? null
      });
    }
  }

  const reworkTasks  = Array.from(taskMap.values());
  const reworkCount  = reworkTasks.length;
  const reworkRate   = totalCompleted > 0 ? round2((reworkCount / totalCompleted) * 100) : 0;
  const totalCostUsd = reworkTasks.reduce((s, t) => s + t.cost, 0);
  const totalHours   = reworkTasks.reduce((s, t) => s + t.hours, 0);
  const hasCogs      = reworkEntries.length > 0;
  const warnings: string[] = hasCogs ? [] : ['cogs_module_inactive: cost fields unavailable'];

  // Count total completed per task_type (for rework_rate_percent per type)
  const completedByType = new Map<string, number>();
  for (const t of completedTasks) {
    const type = (t.taskType as string) ?? 'untyped';
    completedByType.set(type, (completedByType.get(type) ?? 0) + 1);
  }

  // Breakdown by task_type (rework_count, cost, hours)
  const byType = new Map<string, { count: number; cost: number; hours: number }>();
  for (const t of reworkTasks) {
    const type = (t.taskType as string) ?? 'untyped';
    const e    = byType.get(type) ?? { count: 0, cost: 0, hours: 0 };
    e.count++;
    e.cost  += t.cost;
    e.hours += t.hours;
    byType.set(type, e);
  }

  return {
    period,
    project_id:             query.project_id ?? null,
    team_id:                query.team_id ?? null,
    total_tasks_completed:  totalCompleted,
    rework_count:           reworkCount,
    rework_rate_percent:    reworkRate,
    cost_usd:               hasCogs ? round2(totalCostUsd) : null,
    cost_hours:             hasCogs ? round2(totalHours)   : null,
    warnings,
    breakdown_by_type: Array.from(byType.entries())
      .map(([task_type, { count, cost, hours }]) => {
        const typeTotal = completedByType.get(task_type) ?? count;
        return {
          task_type,
          rework_count:          count,
          rework_rate_percent:   typeTotal > 0 ? round2((count / typeTotal) * 100) : 0,
          cost_hours:            hasCogs ? round2(hours) : null,
          cost_usd:              hasCogs ? round2(cost)  : null
        };
      })
      .sort((a, b) => b.rework_count - a.rework_count),
    top_reworked_tasks: reworkTasks
      .sort((a, b) => b.revisions - a.revisions)
      .slice(0, 5)
      .map(t => ({
        task_id:     t.taskId,
        title:       t.title,
        revisions:   t.revisions,
        cost_usd:    hasCogs ? round2(t.cost) : null,
        assignee_id: t.assigneeId ?? null
      }))
  };
}

// ── v2.4: Estimation accuracy ─────────────────────────────────────────────────

export async function getEstimationAccuracy(tenantId: string, query: EstimationAccuracyQuery) {
  const period = query.period ?? lastNMonthsPeriod(6);
  const { dateFrom, dateTo } = query.period ? parsePeriod(query.period) : lastNMonths(6);

  const tasks = await prisma.task.findMany({
    where: {
      tenantId, status: 'done',
      hoursEstimated: { not: null },
      hoursActual:    { not: null },
      completedAt: { gte: dateFrom, lte: dateTo },
      ...(query.project_id && { projectId: query.project_id }),
      ...(query.team_id    && { project: { teamId: query.team_id } })
    },
    select: { id: true, hoursEstimated: true, hoursActual: true, taskType: true, priority: true }
  });

  const totalDone = await prisma.task.count({
    where: {
      tenantId, status: 'done',
      completedAt: { gte: dateFrom, lte: dateTo },
      ...(query.project_id && { projectId: query.project_id }),
      ...(query.team_id    && { project: { teamId: query.team_id } })
    }
  });

  const overruns  = tasks.map(t => ((t.hoursActual! - t.hoursEstimated!) / t.hoursEstimated!) * 100);
  const avgOverrun = tasks.length > 0 ? round2(overruns.reduce((s, v) => s + v, 0) / overruns.length) : 0;
  const coverage  = totalDone > 0 ? round2((tasks.length / totalDone) * 100) : 0;

  // breakdown by type
  const byType = new Map<string, { overruns: number[]; estimated: number[]; actual: number[] }>();
  for (let i = 0; i < tasks.length; i++) {
    const type = (tasks[i].taskType as string) ?? 'untyped';
    const e    = byType.get(type) ?? { overruns: [], estimated: [], actual: [] };
    e.overruns.push(overruns[i]);
    e.estimated.push(tasks[i].hoursEstimated!);
    e.actual.push(tasks[i].hoursActual!);
    byType.set(type, e);
  }

  // breakdown by priority
  const byPriority = new Map<string, { overruns: number[]; estimated: number[]; actual: number[] }>();
  for (let i = 0; i < tasks.length; i++) {
    const p = tasks[i].priority as string;
    const e = byPriority.get(p) ?? { overruns: [], estimated: [], actual: [] };
    e.overruns.push(overruns[i]);
    e.estimated.push(tasks[i].hoursEstimated!);
    e.actual.push(tasks[i].hoursActual!);
    byPriority.set(p, e);
  }

  return {
    period: query.period ?? `last_6_months`,
    project_id:               query.project_id ?? null,
    team_id:                  query.team_id ?? null,
    coverage_percent:         coverage,
    low_coverage_warning:     coverage < 30,
    overall_overrun_percent:  avgOverrun,
    overall_bias:             computeEstimationBias(avgOverrun),
    breakdown_by_type: Array.from(byType.entries())
      .map(([task_type, { overruns: ov, estimated: est, actual: act }]) => {
        const avg = (arr: number[]) => round2(arr.reduce((s, v) => s + v, 0) / arr.length);
        return {
          task_type,
          avg_estimated_hours: avg(est),
          avg_actual_hours:    avg(act),
          avg_overrun_percent: round2(ov.reduce((s, v) => s + v, 0) / ov.length),
          sample_size:         ov.length,
          bias:                computeEstimationBias(ov.reduce((s, v) => s + v, 0) / ov.length)
        };
      })
      .sort((a, b) => b.sample_size - a.sample_size),
    breakdown_by_priority: Array.from(byPriority.entries())
      .map(([priority, { overruns: ov, estimated: est, actual: act }]) => {
        const avg = (arr: number[]) => round2(arr.reduce((s, v) => s + v, 0) / arr.length);
        return {
          priority,
          avg_estimated_hours: avg(est),
          avg_actual_hours:    avg(act),
          avg_overrun_percent: round2(ov.reduce((s, v) => s + v, 0) / ov.length),
          sample_size:         ov.length,
          bias:                computeEstimationBias(ov.reduce((s, v) => s + v, 0) / ov.length)
        };
      })
      .sort((a, b) => a.priority.localeCompare(b.priority))
  };
}

function lastNMonthsPeriod(n: number): string {
  const now = new Date();
  const to  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to);
  from.setMonth(from.getMonth() - n);
  return `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
}

// ── v2.5: Key person risk ─────────────────────────────────────────────────────

export async function getKeyPersonRisk(tenantId: string, query: KeyPersonRiskQuery) {
  const threshold = query.concentration_threshold_percent;

  const activeTasks = await prisma.task.findMany({
    where: {
      tenantId,
      status: { notIn: ['done', 'cancelled'] },
      assigneeId: { not: null },
      ...(query.project_id && { projectId: query.project_id }),
      ...(query.team_id    && { project: { teamId: query.team_id } })
    },
    select: {
      id: true,
      assigneeId: true,
      epicId: true,
      storyPoints: true,
      assignee: { select: { id: true, fullName: true } },
      blockerDeps: { select: { blockedId: true } }
    }
  });

  const total = activeTasks.length;

  // Group by assignee
  const assigneeMap = new Map<string, {
    userId: string; fullName: string; taskCount: number; epicIds: Set<string>;
    blockingOthers: number; storyPoints: number;
  }>();
  for (const task of activeTasks) {
    if (!task.assigneeId) continue;
    const e = assigneeMap.get(task.assigneeId) ?? {
      userId:         task.assigneeId,
      fullName:       task.assignee?.fullName ?? task.assigneeId,
      taskCount:      0,
      epicIds:        new Set<string>(),
      blockingOthers: 0,
      storyPoints:    0
    };
    e.taskCount++;
    if (task.epicId) e.epicIds.add(task.epicId);
    e.blockingOthers += task.blockerDeps.length;
    e.storyPoints    += task.storyPoints ?? 0;
    assigneeMap.set(task.assigneeId, e);
  }

  // Fetch epic names + completion for all epics touched by active tasks
  const allEpicIds = Array.from(new Set(
    Array.from(assigneeMap.values()).flatMap(a => Array.from(a.epicIds))
  ));
  const epicRows = allEpicIds.length > 0
    ? await prisma.epic.findMany({
        where: { id: { in: allEpicIds } },
        select: { id: true, name: true, totalTasks: true, completedTasks: true }
      })
    : [];
  const epicMap = new Map(epicRows.map(e => [e.id, e]));

  const people = Array.from(assigneeMap.values())
    .map(a => {
      const pct        = total > 0 ? round2((a.taskCount / total) * 100) : 0;
      const epicsOwned = Array.from(a.epicIds).map(eid => {
        const ep = epicMap.get(eid);
        return {
          epic_id:            eid,
          epic_name:          ep?.name ?? eid,
          completion_percent: ep && ep.totalTasks > 0 ? round2((ep.completedTasks / ep.totalTasks) * 100) : 0
        };
      });
      return {
        user_id:               a.userId,
        full_name:             a.fullName,
        active_tasks_assigned: a.taskCount,
        concentration_percent: pct,
        risk_level:            computeKeyPersonRiskLevel(pct, threshold),
        epics_owned:           epicsOwned,
        blocking_others:       a.blockingOthers,
        blast_radius: {
          tasks_directly_blocked: a.blockingOthers,
          epics_impacted:         a.epicIds.size,
          estimated_sp_at_risk:   a.storyPoints
        }
      };
    })
    .sort((a, b) => b.concentration_percent - a.concentration_percent);

  const highRisk = people.filter(c => c.risk_level === 'high');

  return {
    project_id:                      query.project_id ?? null,
    team_id:                         query.team_id ?? null,
    concentration_threshold_percent: threshold,
    total_active_tasks:              total,
    high_risk_count:                 highRisk.length,
    people
  };
}

// ── v2.6: Team health ─────────────────────────────────────────────────────────

const DIMENSION_UNITS: Record<string, string> = {
  velocity:         'points_per_week',
  on_time_delivery: 'percent',
  work_quality:     'percent_bugs',
  capacity:         'percent_utilization',
  dora:             'dora_level',
  budget_burn:      'percent_of_budget'
};

function dim(
  name: string,
  available: boolean,
  level: 'good' | 'watch' | 'alert' | null,
  value: number | string | null,
  trend: string | null,
  context: string
) {
  return {
    available,
    level:   available ? level : null,
    value:   available ? value : null,
    unit:    DIMENSION_UNITS[name] ?? name,
    trend:   available ? trend : null,
    context
  };
}

async function computeTeamHealthForOne(tenantId: string, teamId: string, teamName: string, period: string) {
  const { dateFrom, dateTo } = parsePeriod(period);

  const [tasks, cogsEntries, healthMetrics, budget] = await Promise.all([
    prisma.task.findMany({
      where: {
        tenantId,
        project: { teamId },
        completedAt: { gte: dateFrom, lte: dateTo }
      },
      select: { status: true, taskType: true, dueDate: true, completedAt: true, storyPoints: true }
    }),
    prisma.cogsEntry.findMany({
      where: { tenantId, teamId, periodDate: { gte: dateFrom, lte: dateTo } },
      select: { hoursWorked: true, totalCost: true }
    }),
    prisma.healthMetric.findMany({
      where: { tenantId, teamId, computedAt: { gte: dateFrom, lte: dateTo } },
      select: { metricName: true, value: true, level: true },
      orderBy: { computedAt: 'desc' }
    }),
    prisma.cogsBudget.findFirst({
      where: { tenantId, teamId, period },
      select: { budgetAmount: true }
    })
  ]);

  const doneTasks  = tasks.filter(t => t.status === 'done');
  const bugCount   = doneTasks.filter(t => t.taskType === 'bug').length;
  const bugRate    = doneTasks.length > 0 ? round2((bugCount / doneTasks.length) * 100) : 0;

  // on-time delivery
  const withDue   = doneTasks.filter(t => t.dueDate !== null);
  const onTime    = withDue.filter(t => t.completedAt! <= t.dueDate!);
  const onTimeRate = withDue.length > 0 ? round2((onTime.length / withDue.length) * 100) : null;

  // velocity (story points delivered in period)
  const totalPoints = doneTasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);

  // capacity utilization
  const totalHours = cogsEntries.reduce((s, e) => s + e.hoursWorked, 0);
  const totalCost  = cogsEntries.reduce((s, e) => s + e.totalCost, 0);

  // dora overall
  const doraMetric = healthMetrics.find(m => m.metricName === 'dora_overall');

  // budget burn
  const budgetBurn = budget && totalCost > 0
    ? round2((totalCost / budget.budgetAmount) * 100)
    : null;

  // capacity utilization
  const capacityAvailable = totalHours > 0;
  const memberCount = await prisma.teamMember.count({ where: { tenantId, teamId } });
  const capacityTarget = memberCount * 160;
  const utilizationPct = capacityAvailable && capacityTarget > 0
    ? round2((totalHours / capacityTarget) * 100)
    : null;

  const warnings: string[] = [];
  if (!capacityAvailable) warnings.push('cogs_module_inactive: capacity dimension unavailable');
  if (!doraMetric)         warnings.push('dora_module_inactive: dora dimension unavailable');
  if (!budget)             warnings.push('cogs_module_inactive: budget_burn dimension unavailable');

  const velocityLevel = computeTeamHealthDimensionLevel('velocity', 0, { trend: 'stable' });
  const onTimeLevel   = onTimeRate !== null ? computeTeamHealthDimensionLevel('on_time_delivery', onTimeRate) : 'watch';
  const qualityLevel  = computeTeamHealthDimensionLevel('work_quality', bugRate);
  const capacityLevel = utilizationPct !== null ? computeTeamHealthDimensionLevel('capacity', utilizationPct) : 'watch';
  const doraLevel     = doraMetric
    ? computeTeamHealthDimensionLevel('dora', 0, { doraLevel: doraMetric.level ?? undefined })
    : 'alert';
  const budgetLevel   = budgetBurn !== null ? computeTeamHealthDimensionLevel('budget_burn', budgetBurn) : 'watch';

  const dimensions = {
    velocity:         dim('velocity',         true,              velocityLevel, totalPoints,     'stable', `${totalPoints} story points entregues no período`),
    on_time_delivery: dim('on_time_delivery', onTimeRate !== null, onTimeLevel,  onTimeRate,     'stable', onTimeRate !== null ? `${onTimeRate}% das tasks com prazo entregues no prazo` : 'Sem tasks com due_date no período'),
    work_quality:     dim('work_quality',     doneTasks.length > 0, qualityLevel, bugRate,       'stable', `Bugs representam ${bugRate}% do trabalho entregue`),
    capacity:         dim('capacity',         capacityAvailable, capacityLevel, utilizationPct, 'stable', utilizationPct !== null ? `${utilizationPct}% de utilização de capacidade no período` : 'Sem dados de horas trabalhadas'),
    dora:             dim('dora',             doraMetric !== null, doraLevel,    doraMetric?.level ?? null, 'stable', doraMetric ? `DORA overall level: ${doraMetric.level}` : 'Módulo DORA não ativo'),
    budget_burn:      dim('budget_burn',      budget !== null,   budgetLevel,   budgetBurn,     'stable', budgetBurn !== null ? `${budgetBurn}% do orçamento consumido no período` : 'Sem orçamento configurado para o período')
  };

  const availableLevels = Object.values(dimensions)
    .filter(d => d.available)
    .map(d => d.level as 'good' | 'watch' | 'alert');

  return {
    team_id:       teamId,
    team_name:     teamName,
    period,
    warnings,
    dimensions,
    overall_level: computeTeamOverallLevel(availableLevels)
  };
}

export async function getTeamHealth(tenantId: string, query: TeamHealthQuery) {
  const period = query.period ?? currentPeriod();

  if (query.team_id) {
    const team = await prisma.team.findUnique({
      where: { id: query.team_id },
      select: { name: true }
    });
    const teamName = team?.name ?? query.team_id;
    return [await computeTeamHealthForOne(tenantId, query.team_id, teamName, period)];
  }

  // All teams for tenant
  const teams = await prisma.team.findMany({
    where: { tenantId },
    select: { id: true, name: true }
  });

  const results = await Promise.all(
    teams.map(t => computeTeamHealthForOne(tenantId, t.id, t.name, period))
  );

  return results;
}

// ── v2.7: Incident patterns ───────────────────────────────────────────────────

export async function getIncidentPatterns(tenantId: string, query: IncidentPatternsQuery) {
  // Check if any incident integration is active
  const incidentConnection = await prisma.integrationConnection.findFirst({
    where: {
      tenantId,
      provider: { in: ['opsgenie', 'incident_io'] as const },
      status:   'active' as const
    }
  });

  if (!incidentConnection) {
    return {
      period:          null,
      project_id:      query.project_id ?? null,
      total_incidents: 0,
      warnings:        ['no_incident_integration_active'],
      frequency:       null,
      severity_distribution: [],
      hotspot_services: [],
      time_of_day_distribution: [],
      mtta_p50_minutes: null,
      mttr_p50_hours:   null
    };
  }

  const period = query.period ?? currentPeriod();
  const { dateFrom, dateTo } = parsePeriod(period);

  const [incidents, priorIncidents] = await Promise.all([
    prisma.incidentEvent.findMany({
      where: {
        tenantId, openedAt: { gte: dateFrom, lte: dateTo },
        ...(query.project_id && {
          affectedServices: { has: query.project_id }
        })
      },
      select: {
        id: true, openedAt: true, acknowledgedAt: true, resolvedAt: true,
        priority: true, severity: true, affectedServices: true, status: true
      }
    }),
    query.compare_period ? prisma.incidentEvent.findMany({
      where: {
        tenantId,
        openedAt: { gte: parsePeriod(query.compare_period).dateFrom, lte: parsePeriod(query.compare_period).dateTo }
      },
      select: { id: true }
    }) : Promise.resolve(null)
  ]);

  const totalIncidents = incidents.length;

  // MTTA (minutes) / MTTR (hours)
  const mttaMinuteValues = incidents
    .filter(i => i.acknowledgedAt)
    .map(i => (i.acknowledgedAt!.getTime() - i.openedAt.getTime()) / 60000);
  const mttrHourValues = incidents
    .filter(i => i.resolvedAt)
    .map(i => (i.resolvedAt!.getTime() - i.openedAt.getTime()) / 3600000);

  const sortedMtta = [...mttaMinuteValues].sort((a, b) => a - b);
  const sortedMttr = [...mttrHourValues].sort((a, b) => a - b);

  // severity distribution
  const severityMap = new Map<string, { count: number; mttrSum: number; mttrCount: number }>();
  for (const i of incidents) {
    const sev = i.severity ?? i.priority ?? 'unknown';
    const e   = severityMap.get(sev) ?? { count: 0, mttrSum: 0, mttrCount: 0 };
    e.count++;
    if (i.resolvedAt) {
      e.mttrSum += (i.resolvedAt.getTime() - i.openedAt.getTime()) / 3600000;
      e.mttrCount++;
    }
    severityMap.set(sev, e);
  }

  // time of day distribution (UTC hours with incidents)
  const hourMap = new Map<number, number>();
  for (const i of incidents) {
    const h = i.openedAt.getUTCHours();
    hourMap.set(h, (hourMap.get(h) ?? 0) + 1);
  }

  // hotspot services: track count + last_incident_at
  const serviceMap = new Map<string, { count: number; lastAt: Date }>();
  for (const i of incidents) {
    for (const svc of i.affectedServices) {
      const e = serviceMap.get(svc) ?? { count: 0, lastAt: i.openedAt };
      e.count++;
      if (i.openedAt > e.lastAt) e.lastAt = i.openedAt;
      serviceMap.set(svc, e);
    }
  }

  // frequency + comparison
  const curWeeks = (dateTo.getTime() - dateFrom.getTime()) / (7 * 86400000);
  const curPerWeek = curWeeks > 0 ? round2(totalIncidents / curWeeks) : 0;

  let frequency: Record<string, unknown> = { incidents_per_week: curPerWeek, trend: 'stable' };
  if (query.compare_period && priorIncidents) {
    const priorCount  = priorIncidents.length;
    const { dateFrom: cf, dateTo: ct } = parsePeriod(query.compare_period);
    const priorWeeks  = (ct.getTime() - cf.getTime()) / (7 * 86400000);
    const priorPerWeek = priorWeeks > 0 ? round2(priorCount / priorWeeks) : 0;
    const deltaPercent = priorPerWeek > 0 ? round2(((curPerWeek - priorPerWeek) / priorPerWeek) * 100) : 0;
    frequency = {
      incidents_per_week:       curPerWeek,
      trend:                    deltaPercent > 20 ? 'increasing' : deltaPercent < -20 ? 'decreasing' : 'stable',
      compare_period:           query.compare_period,
      incidents_per_week_prior: priorPerWeek,
      delta_percent:            deltaPercent
    };
  }

  return {
    period,
    project_id:      query.project_id ?? null,
    total_incidents: totalIncidents,
    warnings:        [],
    frequency,
    severity_distribution: Array.from(severityMap.entries())
      .map(([severity, { count, mttrSum, mttrCount }]) => ({
        severity,
        count,
        percent:        totalIncidents > 0 ? round2((count / totalIncidents) * 100) : 0,
        avg_mttr_hours: mttrCount > 0 ? round2(mttrSum / mttrCount) : null
      }))
      .sort((a, b) => b.count - a.count),
    hotspot_services: Array.from(serviceMap.entries())
      .map(([service, { count, lastAt }]) => ({
        service,
        count,
        percent:           totalIncidents > 0 ? round2((count / totalIncidents) * 100) : 0,
        last_incident_at:  lastAt.toISOString()
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    time_of_day_distribution: Array.from(hourMap.entries())
      .map(([hour_utc, count]) => ({ hour_utc, count }))
      .sort((a, b) => a.hour_utc - b.hour_utc),
    mtta_p50_minutes: sortedMtta.length > 0 ? round2(computePercentile(sortedMtta, 50)) : null,
    mttr_p50_hours:   sortedMttr.length > 0 ? round2(computePercentile(sortedMttr, 50)) : null
  };
}

// ── v2.8: Deploy quality ──────────────────────────────────────────────────────

export async function getDeployQuality(tenantId: string, query: DeployQualityQuery) {
  const { dateFrom, dateTo } = lastNDays(query.window_days);

  const deploys = await prisma.deployEvent.findMany({
    where: {
      tenantId,
      deployedAt: { gte: dateFrom, lte: dateTo },
      ...(query.project_id && { projectId: query.project_id })
    },
    select: {
      id: true, deployedAt: true, isHotfix: true, isRollback: true,
      ref: true, projectId: true
    },
    orderBy: { deployedAt: 'asc' }
  });

  const total = deploys.length;
  if (total === 0) {
    return {
      project_id:                   query.project_id ?? null,
      window_days:                  query.window_days,
      incident_window_hours:        query.incident_window_hours,
      total_deploys:                0,
      hotfix_count:                 0,
      hotfix_rate_percent:          0,
      rollback_count:               0,
      rollback_rate_percent:        0,
      incident_correlated_count:    0,
      incident_correlated_percent:  0,
      warnings:                     [],
      trend: { hotfix_rate_direction: 'stable', rollback_rate_direction: 'stable', incident_correlation_direction: 'stable' },
      worst_deploys:                []
    };
  }

  const windowMs  = query.incident_window_hours * 3600000;

  // Check incident integration
  const incidentConnection = await prisma.integrationConnection.findFirst({
    where: { tenantId, provider: { in: ['opsgenie', 'incident_io'] as const }, status: 'active' as const }
  });
  const warnings: string[] = incidentConnection ? [] : ['no_incident_integration_active: incident_correlated_percent unavailable'];

  const incidents = incidentConnection
    ? await prisma.incidentEvent.findMany({
        where: {
          tenantId,
          openedAt: { gte: dateFrom, lte: new Date(dateTo.getTime() + windowMs) }
        },
        select: { id: true, openedAt: true, severity: true }
      })
    : [];

  // Correlate: incidents opened within window_hours after each deploy
  const deployCorrelations = deploys.map(d => {
    const deployTime = d.deployedAt.getTime();
    const related    = incidents.filter(
      i => i.openedAt.getTime() >= deployTime &&
           i.openedAt.getTime() <= deployTime + windowMs
    );
    return { deploy: d, incidentCount: related.length, relatedIncidents: related };
  });

  const hotfixes   = deploys.filter(d => d.isHotfix).length;
  const rollbacks  = deploys.filter(d => d.isRollback).length;
  const correlated = deployCorrelations.filter(c => c.incidentCount > 0).length;

  // Trend: compare first half vs second half of the window
  const midIndex    = Math.floor(deploys.length / 2);
  const firstHalf   = deployCorrelations.slice(0, midIndex);
  const secondHalf  = deployCorrelations.slice(midIndex);
  const trendDir = (first: number, total1: number, second: number, total2: number) => {
    const r1 = total1 > 0 ? first / total1 : 0;
    const r2 = total2 > 0 ? second / total2 : 0;
    if (r2 > r1 * 1.2) return 'increasing';
    if (r2 < r1 * 0.8) return 'decreasing';
    return 'stable';
  };

  const trend = {
    hotfix_rate_direction:           trendDir(
      firstHalf.filter(c => c.deploy.isHotfix).length, firstHalf.length,
      secondHalf.filter(c => c.deploy.isHotfix).length, secondHalf.length
    ),
    rollback_rate_direction:         trendDir(
      firstHalf.filter(c => c.deploy.isRollback).length, firstHalf.length,
      secondHalf.filter(c => c.deploy.isRollback).length, secondHalf.length
    ),
    incident_correlation_direction:  incidentConnection ? trendDir(
      firstHalf.filter(c => c.incidentCount > 0).length, firstHalf.length,
      secondHalf.filter(c => c.incidentCount > 0).length, secondHalf.length
    ) : 'stable'
  };

  return {
    project_id:                   query.project_id ?? null,
    window_days:                  query.window_days,
    incident_window_hours:        query.incident_window_hours,
    total_deploys:                total,
    hotfix_count:                 hotfixes,
    hotfix_rate_percent:          round2((hotfixes  / total) * 100),
    rollback_count:               rollbacks,
    rollback_rate_percent:        round2((rollbacks / total) * 100),
    incident_correlated_count:    correlated,
    incident_correlated_percent:  incidentConnection ? round2((correlated / total) * 100) : null,
    warnings,
    trend,
    worst_deploys: deployCorrelations
      .filter(c => c.incidentCount > 0)
      .sort((a, b) => b.incidentCount - a.incidentCount)
      .slice(0, 5)
      .map(c => ({
        deploy_id:     c.deploy.id,
        ref:           c.deploy.ref,
        deployed_at:   c.deploy.deployedAt.toISOString(),
        is_hotfix:     c.deploy.isHotfix,
        is_rollback:   c.deploy.isRollback,
        incident_count_within_window: c.incidentCount,
        incidents: c.relatedIncidents.map(i => ({
          incident_id: i.id,
          severity:    i.severity ?? null,
          opened_at:   i.openedAt.toISOString()
        }))
      }))
  };
}

// ── v2.9: SLA suggestions ─────────────────────────────────────────────────────

export async function getSlaSuggestions(tenantId: string, query: SlaSuggestionsQuery) {
  const { dateFrom, dateTo } = lastNDays(query.window_days);

  const tasks = await prisma.task.findMany({
    where: {
      tenantId,
      status: 'done',
      cycleTimeHours: { not: null },
      completedAt:    { gte: dateFrom, lte: dateTo },
      ...(query.project_id && { projectId: query.project_id }),
      ...(query.team_id    && { project: { teamId: query.team_id } })
    },
    select: { taskType: true, priority: true, cycleTimeHours: true }
  });

  // Group by (taskType, priority) — all observed combinations
  type GroupKey = string;
  const groups = new Map<GroupKey, number[]>();
  for (const t of tasks) {
    if (!t.taskType || !t.priority) continue;
    const key = `${t.taskType as string}::${t.priority as string}`;
    const arr = groups.get(key) ?? [];
    arr.push(t.cycleTimeHours!);
    groups.set(key, arr);
  }

  // Existing SLA templates
  const existingTemplates = await prisma.slaTemplate.findMany({
    where: { tenantId, isActive: true },
    select: { appliesTo: true, rules: true, name: true }
  });

  const pVal = query.target_percentile as 50 | 75 | 90 | 95;

  const suggestions = Array.from(groups.entries()).map(([key, cycleTimes]) => {
    const [task_type, priority] = key.split('::');
    const lowSample = cycleTimes.length < query.min_sample_size;

    if (lowSample) {
      return {
        task_type,
        priority,
        sample_size:              cycleTimes.length,
        low_sample:               true,
        percentiles:              null,
        suggested_target_hours:   null,
        suggested_warning_at_percent: 80,
        rationale: `Amostra insuficiente (${cycleTimes.length} tasks, mínimo ${query.min_sample_size}). Aguardar mais dados para sugestão confiável.`
      };
    }

    const sorted = [...cycleTimes].sort((a, b) => a - b);
    const p50    = computePercentile(sorted, 50);
    const p75    = computePercentile(sorted, 75);
    const p90    = computePercentile(sorted, 90);
    const p95    = computePercentile(sorted, 95);
    const pctileMap: Record<50 | 75 | 90 | 95, number> = { 50: p50, 75: p75, 90: p90, 95: p95 };
    const target = pctileMap[pVal];

    return {
      task_type,
      priority,
      sample_size:              cycleTimes.length,
      low_sample:               false,
      percentiles:              { p50_hours: p50, p75_hours: p75, p90_hours: p90, p95_hours: p95 },
      suggested_target_hours:   target,
      suggested_warning_at_percent: 80,
      rationale: `${pVal}% dos ${task_type} com prioridade ${priority} são concluídos em até ${target}h. Este valor garante que ${pVal} em cada 100 tarefas similares cumpram o SLA.`
    };
  });

  suggestions.sort((a, b) => {
    if (a.task_type !== b.task_type) return a.task_type.localeCompare(b.task_type);
    return a.priority.localeCompare(b.priority);
  });

  // Build sla_template_hints grouped by task_type (only types with at least one sufficient combo)
  // Collect all priorities per task_type (including insufficient ones)
  const allPrioritiesByType = new Map<string, Set<string>>();
  for (const s of suggestions) {
    const set = allPrioritiesByType.get(s.task_type) ?? new Set<string>();
    set.add(s.priority);
    allPrioritiesByType.set(s.task_type, set);
  }

  const hintsByType = new Map<string, Map<string, number | null>>();
  for (const s of suggestions) {
    const priorityMap = hintsByType.get(s.task_type) ?? new Map<string, number | null>();
    priorityMap.set(s.priority, s.suggested_target_hours);
    hintsByType.set(s.task_type, priorityMap);
  }

  const slaTemplateHints = Array.from(hintsByType.entries())
    .filter(([, pMap]) => Array.from(pMap.values()).some(v => v !== null))
    .map(([task_type, priorityMap]) => {
      const existingForType = existingTemplates.find(t => t.appliesTo.includes(task_type));
      const rules: Record<string, { target_minutes: number | null; warning_at_percent: number }> = {};
      for (const [priority, targetHours] of priorityMap.entries()) {
        rules[priority] = {
          target_minutes:    targetHours !== null ? Math.round(targetHours * 60) : null,
          warning_at_percent: 80
        };
      }
      const missing = Object.entries(rules).filter(([, v]) => v.target_minutes === null).map(([p]) => p);
      const note = missing.length > 0
        ? `${missing.join(', ')} sem sugestão por amostra insuficiente. Preencha manualmente antes de criar o template.`
        : undefined;
      return {
        applies_to: [task_type],
        has_active_template: existingForType !== undefined,
        active_template_name: existingForType?.name ?? null,
        rules,
        ...(note ? { note } : {})
      };
    });

  return {
    project_id:        query.project_id ?? null,
    team_id:           query.team_id ?? null,
    window_days:       query.window_days,
    target_percentile: pVal,
    suggestions,
    sla_template_hints: slaTemplateHints
  };
}

// ── v2.10: Trend degradation ──────────────────────────────────────────────────

export async function getTrendDegradation(tenantId: string, query: TrendDegradationQuery) {
  const { dateFrom, dateTo } = lastNDays(query.window_days);

  const metrics = await prisma.healthMetric.findMany({
    where: {
      tenantId,
      computedAt: { gte: dateFrom, lte: dateTo },
      ...(query.project_id && { projectId: query.project_id }),
      ...(query.team_id    && { teamId: query.team_id })
    },
    select: { metricName: true, value: true, computedAt: true, projectId: true, teamId: true },
    orderBy: { computedAt: 'asc' }
  });

  // Group by metricName (+ projectId + teamId for uniqueness)
  const seriesMap = new Map<string, Array<{ ts: number; value: number }>>();
  for (const m of metrics) {
    const key = `${m.metricName}::${m.projectId ?? ''}::${m.teamId ?? ''}`;
    const arr = seriesMap.get(key) ?? [];
    arr.push({ ts: m.computedAt.getTime(), value: m.value });
    seriesMap.set(key, arr);
  }

  const degrading: Array<{
    metric_name: string;
    direction: string;
    slope_per_day: number; r_squared: number; p_value: number;
    statistically_significant: boolean;
    first_value: number; last_value: number;
    decline_percent: number;
    data_points: number;
    interpretation: string;
  }> = [];

  const stable: string[] = [];
  const insufficient: string[] = [];

  for (const [key, series] of seriesMap) {
    const [metricName, projectId, teamId] = key.split('::');
    const pid = projectId || null;
    const tid = teamId    || null;

    if (series.length < query.min_points) {
      insufficient.push(metricName);
      continue;
    }

    // Normalize xs to days from first point to reduce floating point issues
    const t0 = series[0].ts;
    const xs  = series.map(p => (p.ts - t0) / 86400000);
    const ys  = series.map(p => p.value);
    const reg = computeLinearRegression(xs, ys);

    const isSignificant = reg.pValue < query.significance_threshold;
    const isDecline     = reg.slope < 0;

    if (isSignificant && isDecline) {
      const first       = ys[0];
      const last        = ys[ys.length - 1];
      const declinePct  = first !== 0 ? round2(((last - first) / Math.abs(first)) * 100) : 0;
      const interpretation = `${metricName} variou de ${round2(first)} para ${round2(last)} nos últimos ${query.window_days} dias — variação de ${declinePct}%. A tendência é estatisticamente significativa (p=${round2(reg.pValue)}).`;
      degrading.push({
        metric_name:              metricName,
        direction:                'down',
        slope_per_day:            round2(reg.slope),
        r_squared:                round2(reg.rSquared),
        p_value:                  round2(reg.pValue),
        statistically_significant: true,
        first_value:              round2(first),
        last_value:               round2(last),
        decline_percent:          declinePct,
        data_points:              series.length,
        interpretation
      });
    } else {
      if (!stable.includes(metricName)) stable.push(metricName);
    }
  }

  degrading.sort((a, b) => a.slope_per_day - b.slope_per_day); // most degrading first

  return {
    project_id:              query.project_id ?? null,
    team_id:                 query.team_id ?? null,
    window_days:             query.window_days,
    significance_threshold:  query.significance_threshold,
    degrading_metrics:       degrading,
    stable_metrics:          stable,
    insufficient_data_metrics: insufficient
  };
}
