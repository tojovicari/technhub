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
  exportQuerySchema
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

// ── Internal: ISO week start (Monday) ─────────────────────────────────────────

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 = Sun
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

// ── Internal: period → date range (reuses cogs parsePeriod logic) ─────────────

function parsePeriod(period: string): { dateFrom: Date; dateTo: Date } {
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
