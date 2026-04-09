/**
 * COGS Engine — pure calculation functions, no DB dependencies.
 *
 * All money values are in the tenant's configured currency (default USD).
 * Aggregations are additive and auditable: each entry retains its source data.
 */

// ── Core entry calculation ────────────────────────────────────────────────────

/**
 * Compute the total cost of a single COGS entry.
 * For non-labor entries (tooling, cloud, admin): pass hoursWorked=1, hourlyRate=flatAmount, overheadRate=1.
 */
export function computeEntryCost(
  hoursWorked: number,
  hourlyRate: number,
  overheadRate: number = 1.0
): number {
  if (hoursWorked < 0 || hourlyRate < 0 || overheadRate < 0) return 0;
  return round2(hoursWorked * hourlyRate * overheadRate);
}

// ── Story-points model ────────────────────────────────────────────────────────

/**
 * Estimate hours for a task based on historical velocity.
 * velocity = avg(hoursActual / storyPoints) over past N sprints.
 */
export function estimateHoursFromStoryPoints(
  storyPoints: number,
  hoursPerPoint: number
): number {
  if (storyPoints <= 0 || hoursPerPoint <= 0) return 0;
  return round2(storyPoints * hoursPerPoint);
}

/**
 * Compute velocity: hours per story point from historical data.
 * Filters out entries where storyPoints = 0.
 */
export function computeVelocity(
  history: { hoursActual: number; storyPoints: number }[]
): number | null {
  const valid = history.filter((h) => h.storyPoints > 0 && h.hoursActual >= 0);
  if (valid.length === 0) return null;
  const total = valid.reduce((sum, h) => sum + h.hoursActual / h.storyPoints, 0);
  return round2(total / valid.length);
}

// ── Rollup aggregations ────────────────────────────────────────────────────────

/**
 * Sum total cost from a list of entries.
 */
export function sumCost(entries: { totalCost: number }[]): number {
  return round2(entries.reduce((sum, e) => sum + e.totalCost, 0));
}

/**
 * Sum cost by category from a list of entries.
 */
export function sumByCategory<T extends { category: string; totalCost: number }>(
  entries: T[]
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const e of entries) {
    result[e.category] = round2((result[e.category] ?? 0) + e.totalCost);
  }
  return result;
}

/**
 * Compute cost-per-story-point for a set of entries against completed SP.
 */
export function computeCostPerStoryPoint(
  totalCost: number,
  totalStoryPoints: number
): number | null {
  if (totalStoryPoints <= 0) return null;
  return round2(totalCost / totalStoryPoints);
}

// ── Burn rate ─────────────────────────────────────────────────────────────────

export interface BurnRate {
  actualCost: number;
  budgetAmount: number;
  /** Percentage of budget consumed (0–100+). */
  burnPercent: number;
  /** Remaining budget (can be negative if over-budget). */
  remaining: number;
  status: 'on_track' | 'at_risk' | 'over_budget';
}

/**
 * Compute burn rate against a configured budget.
 * - at_risk: > 110% of expected spend at this point in time (or > 90% of total budget)
 * - over_budget: > 100% of total budget
 */
export function computeBurnRate(actualCost: number, budgetAmount: number): BurnRate {
  if (budgetAmount <= 0) {
    return {
      actualCost,
      budgetAmount,
      burnPercent: 100,
      remaining: 0,
      status: 'at_risk'
    };
  }
  const burnPercent = round2((actualCost / budgetAmount) * 100);
  const remaining = round2(budgetAmount - actualCost);
  let status: BurnRate['status'] = 'on_track';
  if (actualCost > budgetAmount) status = 'over_budget';
  else if (burnPercent >= 90) status = 'at_risk';
  return { actualCost, budgetAmount, burnPercent, remaining, status };
}

// ── Planned vs Actual ─────────────────────────────────────────────────────────

export interface PlannedVsActual {
  estimatedCost: number;
  actualCost: number;
  /** Ratio actual/estimated × 100. 100 = on target. */
  deviationPercent: number;
  status: 'on_track' | 'at_risk' | 'over_budget';
}

/**
 * Compare estimated vs actual cost for an epic/project.
 * Thresholds from spec: > 110% → at_risk, > 130% → over_budget (alert to CTO).
 */
export function computePlannedVsActual(
  estimatedCost: number,
  actualCost: number
): PlannedVsActual {
  if (estimatedCost <= 0) {
    return { estimatedCost, actualCost, deviationPercent: 100, status: 'at_risk' };
  }
  const deviationPercent = round2((actualCost / estimatedCost) * 100);
  let status: PlannedVsActual['status'] = 'on_track';
  if (deviationPercent > 130) status = 'over_budget';
  else if (deviationPercent > 110) status = 'at_risk';
  return { estimatedCost, actualCost, deviationPercent, status };
}

// ── ROI ───────────────────────────────────────────────────────────────────────

/**
 * Compute simple ROI for an epic with a defined business value.
 * Returns null if businessValue is not set.
 */
export function computeRoi(
  businessValue: number | null | undefined,
  actualCost: number
): number | null {
  if (businessValue == null || actualCost <= 0) return null;
  return round2(((businessValue - actualCost) / actualCost) * 100);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
