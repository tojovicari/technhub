/**
 * intel/engine.ts
 *
 * Pure intelligence & forecasting functions — no DB, no side-effects.
 * All formulas are deterministic and auditable.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WeeklyPoint {
  weekStart: string; // ISO date of Monday
  points: number;
}

export interface VelocityForecast {
  forecastedPointsPerWeek: number;
  weeklyHistory: WeeklyPoint[];
  trend: 'up' | 'down' | 'stable';
  confidenceScore: number; // 0–100; higher = more reliable
}

export interface EpicCompletionForecast {
  remainingPoints: number;
  velocityPerWeek: number;
  weeksRemaining: number;
  estimatedEndDate: string; // ISO date
}

export type SlaRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SlaRiskResult {
  instanceId: string;
  taskId: string;
  elapsedPercent: number; // 0–100+
  riskScore: number;      // 0–100
  riskLevel: SlaRiskLevel;
  hoursUntilDeadline: number;
  deadlineAt: string;
}

export interface AnomalyPoint {
  date: string;
  value: number;
  zScore: number;
  direction: 'spike' | 'drop';
}

export type RecommendationType =
  | 'improve_deployment_frequency'
  | 'address_sla_violations'
  | 'review_budget'
  | 'investigate_velocity_decline'
  | 'epic_at_risk'
  | 'team_overloaded'
  | 'team_underutilized';

export interface Recommendation {
  type: RecommendationType;
  priority: 'high' | 'medium' | 'low';
  message: string;
  context: Record<string, unknown>;
}

export interface RecommendationSignals {
  doraOverallLevel?: 'elite' | 'high' | 'medium' | 'low' | null;
  burnStatus?: 'on_track' | 'at_risk' | 'over_budget' | null;
  atRiskSlaCount?: number;
  breachedSlaCount?: number;
  velocityTrend?: 'up' | 'down' | 'stable' | null;
  overloadedUserIds?: string[];
  delayedEpics?: Array<{ epicId: string; epicName: string; weeksOverdue: number }>;
}

export interface CapacityEntry {
  userId: string;
  hoursWorked: number;
}

export interface CapacityResult {
  userId: string;
  hoursWorked: number;
  capacityHours: number;
  utilizationPercent: number;
  status: 'under' | 'normal' | 'over';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ── Velocity Forecast ─────────────────────────────────────────────────────────

/**
 * Weighted moving average velocity forecast.
 *
 * Weights are linear: most recent week has the highest weight.
 * Formula: forecast = Σ(points[i] * weight[i]) / Σ(weights)
 * Trend is determined by comparing the mean of the first half vs second half.
 * Confidence degrades with high variance relative to the mean.
 */
export function forecastVelocity(history: WeeklyPoint[]): VelocityForecast {
  const points = history.map(w => w.points);
  const n = points.length;

  if (n === 0) {
    return {
      forecastedPointsPerWeek: 0,
      weeklyHistory: [],
      trend: 'stable',
      confidenceScore: 0
    };
  }

  if (n === 1) {
    return {
      forecastedPointsPerWeek: round2(points[0]),
      weeklyHistory: history,
      trend: 'stable',
      confidenceScore: 30
    };
  }

  // Linearly increasing weights: index 0 (oldest) → weight 1, index n-1 (newest) → weight n
  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < n; i++) {
    const w = i + 1;
    weightedSum += points[i] * w;
    weightTotal += w;
  }
  const forecast = round2(weightedSum / weightTotal);

  // Trend: first-half mean vs second-half mean
  const mid = Math.floor(n / 2);
  const firstHalf = points.slice(0, mid);
  const secondHalf = points.slice(mid);
  const firstMean = mean(firstHalf);
  const secondMean = mean(secondHalf);
  const delta = secondMean - firstMean;
  const trend: 'up' | 'down' | 'stable' =
    delta > firstMean * 0.1 ? 'up' :
    delta < -firstMean * 0.1 ? 'down' :
    'stable';

  // Confidence: 100 - (coefficient of variation * 100), clamped 0–100
  const avg = mean(points);
  const sd = stddev(points, avg);
  const cv = avg > 0 ? sd / avg : 1;
  const confidenceScore = Math.max(0, Math.min(100, Math.round(100 - cv * 100)));

  return { forecastedPointsPerWeek: forecast, weeklyHistory: history, trend, confidenceScore };
}

// ── Epic Completion Forecast ──────────────────────────────────────────────────

/**
 * Estimate epic completion date based on remaining story points and projected velocity.
 * Returns null if velocity is zero (cannot estimate).
 *
 * @param remainingPoints  Total story points of incomplete tasks
 * @param velocityPerWeek  Forecasted points per week
 * @param referenceDate    The date to project from (default: now)
 */
export function forecastEpicCompletion(
  remainingPoints: number,
  velocityPerWeek: number,
  referenceDate: Date = new Date()
): EpicCompletionForecast | null {
  if (velocityPerWeek <= 0 || remainingPoints < 0) return null;

  const weeksRemaining = Math.ceil(remainingPoints / velocityPerWeek);
  const estimatedEnd = new Date(referenceDate);
  estimatedEnd.setDate(estimatedEnd.getDate() + weeksRemaining * 7);

  return {
    remainingPoints,
    velocityPerWeek: round2(velocityPerWeek),
    weeksRemaining,
    estimatedEndDate: estimatedEnd.toISOString().split('T')[0]
  };
}

// ── SLA Risk Scoring ──────────────────────────────────────────────────────────

/**
 * Compute risk level for a running SLA instance.
 *
 * elapsedPercent = (now - startedAt) / (deadlineAt - startedAt) * 100
 * riskLevel:
 *   < 50%  → low
 *   < 70%  → medium
 *   < 90%  → high
 *   ≥ 90%  → critical
 */
export function computeSlaRiskScore(
  instanceId: string,
  taskId: string,
  startedAt: Date,
  deadlineAt: Date,
  now: Date = new Date()
): SlaRiskResult {
  const totalMs = deadlineAt.getTime() - startedAt.getTime();
  const elapsedMs = now.getTime() - startedAt.getTime();
  const elapsedPercent = totalMs > 0 ? round2((elapsedMs / totalMs) * 100) : 100;
  const riskScore = Math.min(100, Math.max(0, round2(elapsedPercent)));
  const hoursUntilDeadline = round2(Math.max(0, (deadlineAt.getTime() - now.getTime()) / 3_600_000));

  const riskLevel: SlaRiskLevel =
    elapsedPercent < 50 ? 'low' :
    elapsedPercent < 70 ? 'medium' :
    elapsedPercent < 90 ? 'high' :
    'critical';

  return {
    instanceId,
    taskId,
    elapsedPercent,
    riskScore,
    riskLevel,
    hoursUntilDeadline,
    deadlineAt: deadlineAt.toISOString()
  };
}

// ── Anomaly Detection ─────────────────────────────────────────────────────────

/**
 * Z-score based anomaly detection on a time series.
 * Flags points where |z| > zThreshold (default 2.0 = ~95th percentile).
 *
 * Returns only the anomalous points, ordered by date.
 */
export function detectAnomalies(
  series: Array<{ date: string; value: number }>,
  zThreshold = 2.0
): AnomalyPoint[] {
  if (series.length < 3) return [];

  const values = series.map(p => p.value);
  const avg = mean(values);
  const sd = stddev(values, avg);

  if (sd === 0) return [];

  const anomalies: AnomalyPoint[] = [];
  for (const point of series) {
    const z = (point.value - avg) / sd;
    if (Math.abs(z) > zThreshold) {
      anomalies.push({
        date: point.date,
        value: round2(point.value),
        zScore: round2(z),
        direction: z > 0 ? 'spike' : 'drop'
      });
    }
  }

  return anomalies.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Recommendations ───────────────────────────────────────────────────────────

/**
 * Rule-based recommendation engine.
 * Returns a prioritised list of actionable recommendations.
 */
export function generateRecommendations(signals: RecommendationSignals): Recommendation[] {
  const recs: Recommendation[] = [];

  if (signals.doraOverallLevel === 'low' || signals.doraOverallLevel === 'medium') {
    recs.push({
      type: 'improve_deployment_frequency',
      priority: signals.doraOverallLevel === 'low' ? 'high' : 'medium',
      message: `DORA overall level is "${signals.doraOverallLevel}". Focus on smaller, more frequent deployments to improve delivery performance.`,
      context: { doraLevel: signals.doraOverallLevel }
    });
  }

  if (signals.breachedSlaCount && signals.breachedSlaCount > 0) {
    recs.push({
      type: 'address_sla_violations',
      priority: 'high',
      message: `${signals.breachedSlaCount} SLA ${signals.breachedSlaCount === 1 ? 'breach' : 'breaches'} detected. Review and resolve overdue tasks immediately.`,
      context: { breachedSlaCount: signals.breachedSlaCount, atRiskSlaCount: signals.atRiskSlaCount ?? 0 }
    });
  } else if (signals.atRiskSlaCount && signals.atRiskSlaCount > 0) {
    recs.push({
      type: 'address_sla_violations',
      priority: 'medium',
      message: `${signals.atRiskSlaCount} SLA ${signals.atRiskSlaCount === 1 ? 'instance is' : 'instances are'} at risk. Prioritise these tasks to avoid breaches.`,
      context: { atRiskSlaCount: signals.atRiskSlaCount }
    });
  }

  if (signals.burnStatus === 'over_budget') {
    recs.push({
      type: 'review_budget',
      priority: 'high',
      message: 'Spending has exceeded the budget for the current period. Review cost entries and realign scope or budget.',
      context: { burnStatus: signals.burnStatus }
    });
  } else if (signals.burnStatus === 'at_risk') {
    recs.push({
      type: 'review_budget',
      priority: 'medium',
      message: 'Spending is approaching the budget limit (≥ 90%). Monitor closely to avoid an overrun.',
      context: { burnStatus: signals.burnStatus }
    });
  }

  if (signals.velocityTrend === 'down') {
    recs.push({
      type: 'investigate_velocity_decline',
      priority: 'medium',
      message: 'Team velocity is declining over the recent weeks. Investigate blockers, dependency delays, or scope creep.',
      context: { velocityTrend: signals.velocityTrend }
    });
  }

  for (const epic of signals.delayedEpics ?? []) {
    recs.push({
      type: 'epic_at_risk',
      priority: epic.weeksOverdue > 2 ? 'high' : 'medium',
      message: `Epic "${epic.epicName}" is estimated to finish ${epic.weeksOverdue} week${epic.weeksOverdue !== 1 ? 's' : ''} past its target date. Consider adjusting scope or resources.`,
      context: { epicId: epic.epicId, weeksOverdue: epic.weeksOverdue }
    });
  }

  for (const userId of signals.overloadedUserIds ?? []) {
    recs.push({
      type: 'team_overloaded',
      priority: 'medium',
      message: `User ${userId} is over capacity this period. Redistribute workload to prevent burnout and quality degradation.`,
      context: { userId }
    });
  }

  // Sort: high → medium → low
  const order = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]);
}

// ── Capacity Utilization ──────────────────────────────────────────────────────

/**
 * Compute utilization per user given their logged hours vs a capacity target.
 *
 * Status thresholds:
 *   under   < 70%
 *   normal  70–110%
 *   over    > 110%
 */
export function computeCapacityUtilization(
  entries: CapacityEntry[],
  capacityHoursPerPeriod: number
): CapacityResult[] {
  return entries.map(e => {
    const utilization = capacityHoursPerPeriod > 0
      ? round2((e.hoursWorked / capacityHoursPerPeriod) * 100)
      : 0;
    const status: 'under' | 'normal' | 'over' =
      utilization < 70 ? 'under' :
      utilization <= 110 ? 'normal' :
      'over';
    return {
      userId: e.userId,
      hoursWorked: round2(e.hoursWorked),
      capacityHours: capacityHoursPerPeriod,
      utilizationPercent: utilization,
      status
    };
  });
}

// ── Roadmap / Gantt ───────────────────────────────────────────────────────────

export interface GanttEpicItem {
  epic_id: string;
  epic_name: string;
  status: string;
  start_date: string | null;        // ISO date
  target_end_date: string | null;   // ISO date from epic.targetEndDate
  estimated_end_date: string | null; // ISO date from velocity forecast
  completion_percent: number;        // 0–100
  total_story_points: number;
  remaining_story_points: number;
  is_delayed: boolean;
  weeks_overdue: number | null;      // null when no targetEndDate
  confidence_score: number;
}

export interface GanttProjectItem {
  project_id: string;
  project_name: string;
  project_key: string;
  status: string;
  start_date: string | null;
  target_end_date: string | null;
  epics: GanttEpicItem[];
}

/**
 * Build a Gantt-friendly epic item from epic data + pre-computed forecast values.
 */
export function buildGanttEpicItem(params: {
  epicId: string;
  epicName: string;
  epicStatus: string;
  startDate: Date | null;
  targetEndDate: Date | null;
  totalStoryPoints: number;
  completedTasks: number;
  totalTasks: number;
  remainingStoryPoints: number;
  velocityPerWeek: number;
  confidenceScore: number;
  referenceDate?: Date;
}): GanttEpicItem {
  const ref = params.referenceDate ?? new Date();

  const completion = params.totalTasks > 0
    ? Math.round((params.completedTasks / params.totalTasks) * 100)
    : 0;

  let estimatedEndDate: string | null = null;
  let isDelayed = false;
  let weeksOverdue: number | null = null;

  if (params.velocityPerWeek > 0 && params.remainingStoryPoints >= 0) {
    const weeksRemaining = Math.ceil(params.remainingStoryPoints / params.velocityPerWeek);
    const estimated = new Date(ref);
    estimated.setDate(estimated.getDate() + weeksRemaining * 7);
    estimatedEndDate = estimated.toISOString().split('T')[0];

    if (params.targetEndDate) {
      const diffMs = estimated.getTime() - params.targetEndDate.getTime();
      weeksOverdue = diffMs > 0 ? Math.ceil(diffMs / (7 * 24 * 3_600_000)) : 0;
      isDelayed = weeksOverdue > 0;
    }
  } else if (params.targetEndDate && ref > params.targetEndDate) {
    // No velocity data but already past target
    isDelayed = true;
    weeksOverdue = Math.ceil((ref.getTime() - params.targetEndDate.getTime()) / (7 * 24 * 3_600_000));
  }

  return {
    epic_id: params.epicId,
    epic_name: params.epicName,
    status: params.epicStatus,
    start_date: params.startDate ? params.startDate.toISOString().split('T')[0] : null,
    target_end_date: params.targetEndDate ? params.targetEndDate.toISOString().split('T')[0] : null,
    estimated_end_date: estimatedEndDate,
    completion_percent: completion,
    total_story_points: params.totalStoryPoints,
    remaining_story_points: params.remainingStoryPoints,
    is_delayed: isDelayed,
    weeks_overdue: weeksOverdue,
    confidence_score: params.confidenceScore
  };
}

// ── Dependency Graph ──────────────────────────────────────────────────────────

export type DependencyStatus = 'blocked' | 'ready' | 'done' | 'cancelled';

export interface DependencyNode {
  task_id: string;
  task_title: string;
  status: string;
  dependency_status: DependencyStatus;
  epic_id: string | null;
  assignee_id: string | null;
  story_points: number | null;
  due_date: string | null;
}

export interface DependencyEdge {
  blocker_id: string;
  blocked_id: string;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

/**
 * Compute dependency_status for each task node given its status and blocking edges.
 *
 * Rules:
 *   - done/cancelled tasks → keep their own status label
 *   - tasks with any open blocker (not done/cancelled) → 'blocked'
 *   - tasks with no open blockers → 'ready'
 */
export function computeDependencyStatuses(
  tasks: Array<{ taskId: string; status: string }>,
  edges: DependencyEdge[]
): Map<string, DependencyStatus> {
  const terminalStatuses = new Set(['done', 'cancelled']);

  // Build set of (blockedId → set of blockerIds still open)
  const openBlockers = new Map<string, Set<string>>();
  for (const edge of edges) {
    const blockerTask = tasks.find(t => t.taskId === edge.blocker_id);
    const isOpen = !blockerTask || !terminalStatuses.has(blockerTask.status);
    if (isOpen) {
      const set = openBlockers.get(edge.blocked_id) ?? new Set<string>();
      set.add(edge.blocker_id);
      openBlockers.set(edge.blocked_id, set);
    }
  }

  const result = new Map<string, DependencyStatus>();
  for (const task of tasks) {
    if (task.status === 'done') {
      result.set(task.taskId, 'done');
    } else if (task.status === 'cancelled') {
      result.set(task.taskId, 'cancelled');
    } else if ((openBlockers.get(task.taskId)?.size ?? 0) > 0) {
      result.set(task.taskId, 'blocked');
    } else {
      result.set(task.taskId, 'ready');
    }
  }
  return result;
}
