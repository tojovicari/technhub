import { describe, expect, it } from 'vitest';
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
import type { TaskForCogs } from './engine.js';

// ── computeEntryCost ──────────────────────────────────────────────────────────

describe('computeEntryCost', () => {
  it('basic: hours × rate × overhead', () => {
    expect(computeEntryCost(8, 100, 1.3)).toBe(1040);
  });

  it('no overhead (default 1.0)', () => {
    expect(computeEntryCost(8, 100)).toBe(800);
  });

  it('zero hours → 0', () => {
    expect(computeEntryCost(0, 100, 1.3)).toBe(0);
  });

  it('negative values → 0', () => {
    expect(computeEntryCost(-1, 100, 1.3)).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    expect(computeEntryCost(1, 33.333, 1)).toBe(33.33);
  });
});

// ── computeVelocity ───────────────────────────────────────────────────────────

describe('computeVelocity', () => {
  it('returns null for empty history', () => {
    expect(computeVelocity([])).toBeNull();
  });

  it('returns null when all storyPoints = 0', () => {
    expect(computeVelocity([{ hoursActual: 8, storyPoints: 0 }])).toBeNull();
  });

  it('computes average hours per SP', () => {
    const history = [
      { hoursActual: 8, storyPoints: 2 },  // 4h/SP
      { hoursActual: 12, storyPoints: 3 }  // 4h/SP
    ];
    expect(computeVelocity(history)).toBe(4);
  });

  it('ignores entries with 0 storyPoints', () => {
    const history = [
      { hoursActual: 8, storyPoints: 2 },
      { hoursActual: 5, storyPoints: 0 }
    ];
    expect(computeVelocity(history)).toBe(4);
  });
});

// ── estimateHoursFromStoryPoints ──────────────────────────────────────────────

describe('estimateHoursFromStoryPoints', () => {
  it('simple multiplication', () => {
    expect(estimateHoursFromStoryPoints(5, 4)).toBe(20);
  });

  it('zero SP → 0', () => {
    expect(estimateHoursFromStoryPoints(0, 4)).toBe(0);
  });
});

// ── sumCost ───────────────────────────────────────────────────────────────────

describe('sumCost', () => {
  it('sums all totalCost values', () => {
    expect(sumCost([{ totalCost: 100 }, { totalCost: 200.5 }])).toBe(300.5);
  });

  it('empty array → 0', () => {
    expect(sumCost([])).toBe(0);
  });
});

// ── sumByCategory ─────────────────────────────────────────────────────────────

describe('sumByCategory', () => {
  it('groups by category correctly', () => {
    const entries = [
      { category: 'engineering', totalCost: 1000 },
      { category: 'tooling', totalCost: 200 },
      { category: 'engineering', totalCost: 500 }
    ];
    const result = sumByCategory(entries);
    expect(result.engineering).toBe(1500);
    expect(result.tooling).toBe(200);
  });
});

// ── computeCostPerStoryPoint ──────────────────────────────────────────────────

describe('computeCostPerStoryPoint', () => {
  it('divides cost by SP', () => {
    expect(computeCostPerStoryPoint(2000, 20)).toBe(100);
  });

  it('returns null when SP = 0', () => {
    expect(computeCostPerStoryPoint(2000, 0)).toBeNull();
  });
});

// ── computeBurnRate ───────────────────────────────────────────────────────────

describe('computeBurnRate', () => {
  it('on_track when < 90%', () => {
    const result = computeBurnRate(800, 1000);
    expect(result.burnPercent).toBe(80);
    expect(result.status).toBe('on_track');
    expect(result.remaining).toBe(200);
  });

  it('at_risk when >= 90% and <= 100%', () => {
    const result = computeBurnRate(900, 1000);
    expect(result.status).toBe('at_risk');
  });

  it('over_budget when > 100%', () => {
    const result = computeBurnRate(1100, 1000);
    expect(result.status).toBe('over_budget');
    expect(result.remaining).toBe(-100);
  });

  it('at_risk when budget = 0', () => {
    const result = computeBurnRate(0, 0);
    expect(result.status).toBe('at_risk');
  });
});

// ── computePlannedVsActual ────────────────────────────────────────────────────

describe('computePlannedVsActual', () => {
  it('on_track when <= 110%', () => {
    const result = computePlannedVsActual(1000, 1000);
    expect(result.deviationPercent).toBe(100);
    expect(result.status).toBe('on_track');
  });

  it('at_risk between 110% and 130%', () => {
    const result = computePlannedVsActual(1000, 1200);
    expect(result.status).toBe('at_risk');
  });

  it('over_budget > 130%', () => {
    const result = computePlannedVsActual(1000, 1400);
    expect(result.status).toBe('over_budget');
  });

  it('at_risk when estimated = 0', () => {
    const result = computePlannedVsActual(0, 500);
    expect(result.status).toBe('at_risk');
  });
});

// ── computeRoi ────────────────────────────────────────────────────────────────

describe('computeRoi', () => {
  it('positive ROI', () => {
    // cost 1000, value 2000 → ROI = 100%
    expect(computeRoi(2000, 1000)).toBe(100);
  });

  it('negative ROI', () => {
    // cost 1000, value 500 → ROI = -50%
    expect(computeRoi(500, 1000)).toBe(-50);
  });

  it('null when businessValue is null', () => {
    expect(computeRoi(null, 1000)).toBeNull();
  });

  it('null when actualCost = 0', () => {
    expect(computeRoi(2000, 0)).toBeNull();
  });
});

// ── resolveHourlyRate ─────────────────────────────────────────────────────────

describe('resolveHourlyRate', () => {
  it('uses user rate when present', () => {
    const r = resolveHourlyRate({ hourlyRate: 80 }, { hourlyRate: 50 });
    expect(r).toEqual({ hourlyRate: 80, source: 'user' });
  });

  it('falls back to team rate when user has no rate', () => {
    const r = resolveHourlyRate({ hourlyRate: null }, { hourlyRate: 50 });
    expect(r).toEqual({ hourlyRate: 50, source: 'team' });
  });

  it('returns none when both are null', () => {
    const r = resolveHourlyRate(null, null);
    expect(r).toEqual({ hourlyRate: 0, source: 'none' });
  });

  it('ignores user rate of 0 and falls back to team', () => {
    const r = resolveHourlyRate({ hourlyRate: 0 }, { hourlyRate: 60 });
    expect(r).toEqual({ hourlyRate: 60, source: 'team' });
  });
});

// ── deriveTaskCogs ────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskForCogs> = {}): TaskForCogs {
  return {
    id: 'task-1',
    status: 'done',
    hoursActual: 8,
    cycleTimeHours: null,
    hoursEstimated: 10,
    storyPoints: 3,
    epicId: 'epic-1',
    projectId: 'proj-1',
    assigneeId: 'user-1',
    completedAt: new Date('2026-04-01'),
    ...overrides
  };
}

const HIGH_RATE = { hourlyRate: 100, source: 'user' as const };
const NO_RATE   = { hourlyRate: 0,   source: 'none' as const };

describe('deriveTaskCogs', () => {
  it('done task with hoursActual → engineering, source: timetracking, confidence: high', () => {
    const result = deriveTaskCogs(makeTask(), HIGH_RATE, 1.3, null);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.input.category).toBe('engineering');
    expect(result.input.source).toBe('timetracking');
    expect(result.input.confidence).toBe('high');
    expect(result.input.hoursWorked).toBe(8);
    expect(result.input.totalCost).toBe(1040); // 8 × 100 × 1.3
  });

  it('prefers hoursActual over hoursEstimated', () => {
    const result = deriveTaskCogs(makeTask({ hoursActual: 8, hoursEstimated: 10 }), HIGH_RATE, 1.0, null);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.input.hoursWorked).toBe(8);
    expect(result.input.source).toBe('timetracking');
  });

  it('falls back to hoursEstimated when no hoursActual', () => {
    const result = deriveTaskCogs(makeTask({ hoursActual: null }), HIGH_RATE, 1.0, null);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.input.hoursWorked).toBe(10);
    expect(result.input.source).toBe('estimate');
    expect(result.input.confidence).toBe('low');
  });

  it('falls back to storyPoints × velocity when no hours', () => {
    const result = deriveTaskCogs(makeTask({ hoursActual: null, hoursEstimated: null }), HIGH_RATE, 1.0, 4);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.input.hoursWorked).toBe(12); // 3 SP × 4h/SP
    expect(result.input.source).toBe('story_points');
    expect(result.input.confidence).toBe('medium');
  });

  it('skips task with no time data at all', () => {
    const result = deriveTaskCogs(
      makeTask({ hoursActual: null, hoursEstimated: null, storyPoints: null }),
      HIGH_RATE, 1.0, null
    );
    expect(result.kind).toBe('skip');
    if (result.kind !== 'skip') return;
    expect(result.reason).toBe('no_time_data');
  });

  it('cancelled task with hoursActual → overhead/cancelled_task (waste)', () => {
    const result = deriveTaskCogs(makeTask({ status: 'cancelled' }), HIGH_RATE, 1.3, null);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.input.category).toBe('overhead');
    expect(result.input.subcategory).toBe('cancelled_task');
  });

  it('cancelled task with no hours → skip', () => {
    const result = deriveTaskCogs(
      makeTask({ status: 'cancelled', hoursActual: null, hoursEstimated: null, storyPoints: null }),
      HIGH_RATE, 1.0, null
    );
    expect(result.kind).toBe('skip');
    if (result.kind !== 'skip') return;
    expect(result.reason).toBe('cancelled_no_hours');
  });

  it('in_progress task → skipped', () => {
    const result = deriveTaskCogs(makeTask({ status: 'in_progress' }), HIGH_RATE, 1.0, null);
    expect(result.kind).toBe('skip');
  });

  it('no rate → kind: no_rate, totalCost: 0, confidence: low', () => {
    const result = deriveTaskCogs(makeTask(), NO_RATE, 1.3, null);
    expect(result.kind).toBe('no_rate');
    if (result.kind !== 'no_rate') return;
    expect(result.input.totalCost).toBe(0);
    expect(result.input.confidence).toBe('low');
  });
});
