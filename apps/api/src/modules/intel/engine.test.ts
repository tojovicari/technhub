import { describe, expect, it } from 'vitest';
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
  computePercentile
} from './engine.js';

// ── forecastVelocity ──────────────────────────────────────────────────────────

describe('forecastVelocity', () => {
  it('returns zero forecast for empty history', () => {
    const r = forecastVelocity([]);
    expect(r.forecastedPointsPerWeek).toBe(0);
    expect(r.confidenceScore).toBe(0);
    expect(r.trend).toBe('stable');
  });

  it('returns single value for one-week history', () => {
    const r = forecastVelocity([{ weekStart: '2026-04-06', points: 20 }]);
    expect(r.forecastedPointsPerWeek).toBe(20);
    expect(r.trend).toBe('stable');
  });

  it('weights recent weeks more heavily', () => {
    // [10, 10, 30] — recent spike should pull forecast above simple avg (50/3≈16.7)
    const r = forecastVelocity([
      { weekStart: '2026-03-16', points: 10 },
      { weekStart: '2026-03-23', points: 10 },
      { weekStart: '2026-03-30', points: 30 }
    ]);
    // weighted = (10*1 + 10*2 + 30*3) / 6 = (10+20+90)/6 = 120/6 = 20
    expect(r.forecastedPointsPerWeek).toBe(20);
  });

  it('detects upward trend', () => {
    const history = [
      { weekStart: '2026-03-02', points: 5 },
      { weekStart: '2026-03-09', points: 6 },
      { weekStart: '2026-03-16', points: 20 },
      { weekStart: '2026-03-23', points: 25 }
    ];
    const r = forecastVelocity(history);
    expect(r.trend).toBe('up');
  });

  it('detects downward trend', () => {
    const history = [
      { weekStart: '2026-03-02', points: 30 },
      { weekStart: '2026-03-09', points: 28 },
      { weekStart: '2026-03-16', points: 5 },
      { weekStart: '2026-03-23', points: 4 }
    ];
    const r = forecastVelocity(history);
    expect(r.trend).toBe('down');
  });

  it('constant history gives 100 confidence', () => {
    const history = Array.from({ length: 8 }, (_, i) => ({
      weekStart: `2026-0${2 + Math.floor(i / 4)}-${String((i % 4) * 7 + 1).padStart(2, '0')}`,
      points: 20
    }));
    const r = forecastVelocity(history);
    expect(r.confidenceScore).toBe(100);
  });
});

// ── forecastEpicCompletion ────────────────────────────────────────────────────

describe('forecastEpicCompletion', () => {
  it('returns null when velocity is zero', () => {
    expect(forecastEpicCompletion(40, 0, new Date())).toBeNull();
  });

  it('returns null when remaining points is negative', () => {
    expect(forecastEpicCompletion(-5, 10, new Date())).toBeNull();
  });

  it('computes weeks remaining and end date', () => {
    const ref = new Date('2026-04-06'); // Monday
    const r = forecastEpicCompletion(20, 10, ref);
    expect(r).not.toBeNull();
    expect(r!.weeksRemaining).toBe(2);
    expect(r!.estimatedEndDate).toBe('2026-04-20');
  });

  it('rounds up remaining weeks', () => {
    const ref = new Date('2026-04-06');
    const r = forecastEpicCompletion(15, 10, ref); // 1.5 → ceil 2
    expect(r!.weeksRemaining).toBe(2);
  });

  it('zero remaining points gives 0 weeks', () => {
    const ref = new Date('2026-04-06');
    const r = forecastEpicCompletion(0, 10, ref);
    expect(r!.weeksRemaining).toBe(0);
    expect(r!.estimatedEndDate).toBe('2026-04-06');
  });
});

// ── computeSlaRiskScore ───────────────────────────────────────────────────────

describe('computeSlaRiskScore', () => {
  const started = new Date('2026-04-01T00:00:00Z');
  const deadline = new Date('2026-04-11T00:00:00Z'); // 10 days window

  it('low risk at 30% elapsed', () => {
    const now = new Date('2026-04-04T00:00:00Z'); // 3/10 days = 30%
    const r = computeSlaRiskScore('i1', 't1', started, deadline, now);
    expect(r.riskLevel).toBe('low');
    expect(r.elapsedPercent).toBe(30);
  });

  it('medium risk at 60% elapsed', () => {
    const now = new Date('2026-04-07T00:00:00Z'); // 6/10 = 60%
    const r = computeSlaRiskScore('i1', 't1', started, deadline, now);
    expect(r.riskLevel).toBe('medium');
  });

  it('high risk at 80% elapsed', () => {
    const now = new Date('2026-04-09T00:00:00Z'); // 8/10 = 80%
    const r = computeSlaRiskScore('i1', 't1', started, deadline, now);
    expect(r.riskLevel).toBe('high');
  });

  it('critical risk at 95% elapsed', () => {
    const now = new Date('2026-04-10T12:00:00Z'); // 9.5/10 = 95%
    const r = computeSlaRiskScore('i1', 't1', started, deadline, now);
    expect(r.riskLevel).toBe('critical');
  });

  it('clamps riskScore to 100 when past deadline', () => {
    const now = new Date('2026-04-15T00:00:00Z'); // past deadline
    const r = computeSlaRiskScore('i1', 't1', started, deadline, now);
    expect(r.riskScore).toBe(100);
    expect(r.hoursUntilDeadline).toBe(0);
  });

  it('attaches instanceId and taskId', () => {
    const now = new Date('2026-04-05T00:00:00Z');
    const r = computeSlaRiskScore('inst-9', 'task-8', started, deadline, now);
    expect(r.instanceId).toBe('inst-9');
    expect(r.taskId).toBe('task-8');
  });
});

// ── detectAnomalies ───────────────────────────────────────────────────────────

describe('detectAnomalies', () => {
  it('returns empty for fewer than 3 points', () => {
    expect(detectAnomalies([{ date: '2026-01-01', value: 10 }])).toEqual([]);
    expect(detectAnomalies([])).toEqual([]);
  });

  it('returns empty when all values are identical (stddev = 0)', () => {
    const series = [
      { date: '2026-01-01', value: 5 },
      { date: '2026-01-02', value: 5 },
      { date: '2026-01-03', value: 5 }
    ];
    expect(detectAnomalies(series)).toEqual([]);
  });

  it('detects a spike', () => {
    // 8 normal + 1 large spike → z ≈ 2.67 > 2.0
    const series = [
      { date: '2026-01-01', value: 10 },
      { date: '2026-01-02', value: 10 },
      { date: '2026-01-03', value: 10 },
      { date: '2026-01-04', value: 10 },
      { date: '2026-01-05', value: 10 },
      { date: '2026-01-06', value: 10 },
      { date: '2026-01-07', value: 10 },
      { date: '2026-01-08', value: 10 },
      { date: '2026-01-09', value: 100 } // spike
    ];
    const result = detectAnomalies(series, 2.0);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].direction).toBe('spike');
  });

  it('detects a drop', () => {
    // 8 normal + 1 near-zero drop → z ≈ -2.67 < -2.0
    const series = [
      { date: '2026-01-01', value: 50 },
      { date: '2026-01-02', value: 50 },
      { date: '2026-01-03', value: 50 },
      { date: '2026-01-04', value: 50 },
      { date: '2026-01-05', value: 50 },
      { date: '2026-01-06', value: 50 },
      { date: '2026-01-07', value: 50 },
      { date: '2026-01-08', value: 50 },
      { date: '2026-01-09', value: 1 } // drop
    ];
    const result = detectAnomalies(series, 2.0);
    expect(result.some(r => r.direction === 'drop')).toBe(true);
  });

  it('respects custom z_threshold', () => {
    // With z=10, nothing should flag on mild variance
    const series = [
      { date: '2026-01-01', value: 10 },
      { date: '2026-01-02', value: 12 },
      { date: '2026-01-03', value: 20 }
    ];
    expect(detectAnomalies(series, 10)).toEqual([]);
  });

  it('orders results by date', () => {
    const series = [
      { date: '2026-01-05', value: 100 },
      { date: '2026-01-01', value: 10 },
      { date: '2026-01-03', value: 10 },
      { date: '2026-01-04', value: 10 },
      { date: '2026-01-02', value: 100 }
    ];
    const result = detectAnomalies(series, 1.0);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].date >= result[i - 1].date).toBe(true);
    }
  });
});

// ── generateRecommendations ───────────────────────────────────────────────────

describe('generateRecommendations', () => {
  it('returns empty for all-good signals', () => {
    const r = generateRecommendations({
      doraOverallLevel: 'elite',
      burnStatus: 'on_track',
      atRiskSlaCount: 0,
      breachedSlaCount: 0,
      velocityTrend: 'up',
      delayedEpics: [],
      overloadedUserIds: []
    });
    expect(r).toEqual([]);
  });

  it('generates high priority recommendation for low DORA', () => {
    const r = generateRecommendations({ doraOverallLevel: 'low' });
    expect(r.some(rec => rec.type === 'improve_deployment_frequency' && rec.priority === 'high')).toBe(true);
  });

  it('generates recommendation for breached SLAs over at-risk', () => {
    const r = generateRecommendations({ breachedSlaCount: 3, atRiskSlaCount: 1 });
    const slaRec = r.find(rec => rec.type === 'address_sla_violations');
    expect(slaRec?.priority).toBe('high');
    expect(slaRec?.context.breachedSlaCount).toBe(3);
  });

  it('generates medium recommendation when only at-risk SLAs', () => {
    const r = generateRecommendations({ atRiskSlaCount: 2, breachedSlaCount: 0 });
    const slaRec = r.find(rec => rec.type === 'address_sla_violations');
    expect(slaRec?.priority).toBe('medium');
  });

  it('generates high priority recommendation for over_budget', () => {
    const r = generateRecommendations({ burnStatus: 'over_budget' });
    expect(r.some(rec => rec.type === 'review_budget' && rec.priority === 'high')).toBe(true);
  });

  it('generates velocity decline recommendation', () => {
    const r = generateRecommendations({ velocityTrend: 'down' });
    expect(r.some(rec => rec.type === 'investigate_velocity_decline')).toBe(true);
  });

  it('generates epic_at_risk recommendations', () => {
    const r = generateRecommendations({
      delayedEpics: [
        { epicId: 'e1', epicName: 'Auth', weeksOverdue: 1 },
        { epicId: 'e2', epicName: 'Billing', weeksOverdue: 4 }
      ]
    });
    const epicRecs = r.filter(rec => rec.type === 'epic_at_risk');
    expect(epicRecs).toHaveLength(2);
    // 4 weeks overdue → high priority
    expect(epicRecs.find(r => (r.context.epicId as string) === 'e2')?.priority).toBe('high');
  });

  it('generates team_overloaded recommendations', () => {
    const r = generateRecommendations({ overloadedUserIds: ['user-1', 'user-2'] });
    expect(r.filter(rec => rec.type === 'team_overloaded')).toHaveLength(2);
  });

  it('sorts by priority: high → medium → low', () => {
    const r = generateRecommendations({
      doraOverallLevel: 'medium',   // medium
      burnStatus: 'over_budget',    // high
      velocityTrend: 'down'         // medium
    });
    const priorities = r.map(rec => rec.priority);
    const order = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < priorities.length; i++) {
      expect(order[priorities[i]] >= order[priorities[i - 1]]).toBe(true);
    }
  });
});

// ── computeCapacityUtilization ────────────────────────────────────────────────

describe('computeCapacityUtilization', () => {
  it('returns empty array for no entries', () => {
    expect(computeCapacityUtilization([], 160)).toEqual([]);
  });

  it('marks under when hours < 70% of capacity', () => {
    const r = computeCapacityUtilization([{ userId: 'u1', hoursWorked: 80 }], 160);
    expect(r[0].status).toBe('under');
    expect(r[0].utilizationPercent).toBe(50);
  });

  it('marks normal when hours between 70–110%', () => {
    const r = computeCapacityUtilization([{ userId: 'u1', hoursWorked: 130 }], 160);
    expect(r[0].status).toBe('normal');
  });

  it('marks over when hours > 110% of capacity', () => {
    const r = computeCapacityUtilization([{ userId: 'u1', hoursWorked: 200 }], 160);
    expect(r[0].status).toBe('over');
  });

  it('handles zero capacity without division error', () => {
    const r = computeCapacityUtilization([{ userId: 'u1', hoursWorked: 100 }], 0);
    expect(r[0].utilizationPercent).toBe(0);
    expect(r[0].status).toBe('under');
  });

  it('returns correct capacity_hours for each user', () => {
    const r = computeCapacityUtilization([{ userId: 'u1', hoursWorked: 120 }], 160);
    expect(r[0].capacityHours).toBe(160);
    expect(r[0].hoursWorked).toBe(120);
  });
});

// ── buildGanttEpicItem ────────────────────────────────────────────────────────────

describe('buildGanttEpicItem', () => {
  const BASE = {
    epicId: 'e1', epicName: 'Auth', epicStatus: 'active',
    startDate: new Date('2026-03-01'), targetEndDate: new Date('2026-04-30'),
    totalStoryPoints: 40, completedTasks: 6, totalTasks: 10,
    remainingStoryPoints: 20, velocityPerWeek: 10, confidenceScore: 75
  };

  it('computes completion_percent correctly', () => {
    const r = buildGanttEpicItem(BASE);
    expect(r.completion_percent).toBe(60); // 6/10
  });

  it('marks is_delayed when estimated end is past target', () => {
    // velocity=10, remaining=20 → 2 weeks from ref=2026-04-25 → estimated=2026-05-09 > target=2026-04-30
    const r = buildGanttEpicItem({ ...BASE, referenceDate: new Date('2026-04-25') });
    expect(r.is_delayed).toBe(true);
    expect(r.weeks_overdue).toBeGreaterThan(0);
  });

  it('is_delayed false when estimated end is before target', () => {
    // velocity=10, remaining=20 → 2 weeks from ref=2026-04-01 → estimated=2026-04-15 < target=2026-04-30
    const r = buildGanttEpicItem({ ...BASE, referenceDate: new Date('2026-04-01') });
    expect(r.is_delayed).toBe(false);
    expect(r.weeks_overdue).toBe(0);
  });

  it('handles zero velocity gracefully: no estimated_end_date', () => {
    const r = buildGanttEpicItem({ ...BASE, velocityPerWeek: 0 });
    expect(r.estimated_end_date).toBeNull();
  });

  it('handles no targetEndDate: weeks_overdue is null', () => {
    const r = buildGanttEpicItem({ ...BASE, targetEndDate: null });
    expect(r.weeks_overdue).toBeNull();
  });

  it('completion_percent is 0 when totalTasks is 0', () => {
    const r = buildGanttEpicItem({ ...BASE, totalTasks: 0, completedTasks: 0 });
    expect(r.completion_percent).toBe(0);
  });

  it('includes start_date and target_end_date as ISO date strings', () => {
    const r = buildGanttEpicItem(BASE);
    expect(r.start_date).toBe('2026-03-01');
    expect(r.target_end_date).toBe('2026-04-30');
  });
});

// ── computeDependencyStatuses ───────────────────────────────────────────────────

describe('computeDependencyStatuses', () => {
  it('ready when task has no blockers', () => {
    const tasks = [{ taskId: 't1', status: 'in_progress' }];
    const map = computeDependencyStatuses(tasks, []);
    expect(map.get('t1')).toBe('ready');
  });

  it('blocked when blocker is still open', () => {
    const tasks = [
      { taskId: 't1', status: 'in_progress' },
      { taskId: 't2', status: 'todo' }
    ];
    // t1 blocks t2
    const map = computeDependencyStatuses(tasks, [{ blocker_id: 't1', blocked_id: 't2' }]);
    expect(map.get('t2')).toBe('blocked');
    expect(map.get('t1')).toBe('ready'); // t1 itself has no open blockers
  });

  it('ready when all blockers are done', () => {
    const tasks = [
      { taskId: 't1', status: 'done' },
      { taskId: 't2', status: 'in_progress' }
    ];
    const map = computeDependencyStatuses(tasks, [{ blocker_id: 't1', blocked_id: 't2' }]);
    expect(map.get('t2')).toBe('ready'); // blocker t1 is done
  });

  it('done tasks remain done regardless of edges', () => {
    const tasks = [
      { taskId: 't1', status: 'in_progress' },
      { taskId: 't2', status: 'done' }
    ];
    const map = computeDependencyStatuses(tasks, [{ blocker_id: 't1', blocked_id: 't2' }]);
    expect(map.get('t2')).toBe('done');
  });

  it('cancelled tasks remain cancelled', () => {
    const tasks = [{ taskId: 't1', status: 'cancelled' }];
    const map = computeDependencyStatuses(tasks, []);
    expect(map.get('t1')).toBe('cancelled');
  });

  it('handles tasks with unknown blocker (missing from list) as open', () => {
    // t2 has a blocker t1 that is not in the tasks list — treated as open
    const tasks = [{ taskId: 't2', status: 'todo' }];
    const map = computeDependencyStatuses(tasks, [{ blocker_id: 't1', blocked_id: 't2' }]);
    expect(map.get('t2')).toBe('blocked');
  });
});

// ── computeWorkMixSignal ──────────────────────────────────────────────────────

describe('computeWorkMixSignal', () => {
  it('returns stable for null delta', () => {
    expect(computeWorkMixSignal('bug', null)).toBe('stable');
  });

  it('alerts when bug grows > 10pp', () => {
    expect(computeWorkMixSignal('bug', 10.1)).toBe('alert');
    expect(computeWorkMixSignal('tech_debt', 15)).toBe('alert');
  });

  it('watches when bug grows 5–10pp', () => {
    expect(computeWorkMixSignal('bug', 7)).toBe('watch');
    expect(computeWorkMixSignal('tech_debt', 5.1)).toBe('watch');
  });

  it('returns stable when bug grows ≤ 5pp', () => {
    expect(computeWorkMixSignal('bug', 5)).toBe('stable');
    expect(computeWorkMixSignal('bug', -3)).toBe('stable');
  });

  it('declines when feature shrinks > 10pp', () => {
    expect(computeWorkMixSignal('feature', -10.1)).toBe('decline');
    expect(computeWorkMixSignal('feature', -20)).toBe('decline');
  });

  it('watches when feature shrinks 5–10pp', () => {
    expect(computeWorkMixSignal('feature', -7)).toBe('watch');
    expect(computeWorkMixSignal('feature', -5.1)).toBe('watch');
  });

  it('returns stable for feature with small delta', () => {
    expect(computeWorkMixSignal('feature', -5)).toBe('stable');
    expect(computeWorkMixSignal('feature', 3)).toBe('stable');
  });

  it('returns stable for chore regardless of delta', () => {
    expect(computeWorkMixSignal('chore', 20)).toBe('stable');
  });
});

// ── computeEstimationBias ─────────────────────────────────────────────────────

describe('computeEstimationBias', () => {
  it('returns overrun when avg > 15%', () => {
    expect(computeEstimationBias(15.1)).toBe('overrun');
    expect(computeEstimationBias(50)).toBe('overrun');
  });

  it('returns underrun when avg < -15%', () => {
    expect(computeEstimationBias(-15.1)).toBe('underrun');
    expect(computeEstimationBias(-100)).toBe('underrun');
  });

  it('returns accurate within ±15%', () => {
    expect(computeEstimationBias(0)).toBe('accurate');
    expect(computeEstimationBias(15)).toBe('accurate');
    expect(computeEstimationBias(-15)).toBe('accurate');
  });
});

// ── computeKeyPersonRiskLevel ─────────────────────────────────────────────────

describe('computeKeyPersonRiskLevel', () => {
  it('high when pct >= threshold', () => {
    expect(computeKeyPersonRiskLevel(30, 30)).toBe('high');
    expect(computeKeyPersonRiskLevel(50, 30)).toBe('high');
  });

  it('medium when pct >= threshold/2', () => {
    expect(computeKeyPersonRiskLevel(15, 30)).toBe('medium');
    expect(computeKeyPersonRiskLevel(20, 30)).toBe('medium');
  });

  it('low when pct < threshold/2', () => {
    expect(computeKeyPersonRiskLevel(14, 30)).toBe('low');
    expect(computeKeyPersonRiskLevel(0, 30)).toBe('low');
  });
});

// ── computeTeamHealthDimensionLevel ──────────────────────────────────────────

describe('computeTeamHealthDimensionLevel', () => {
  it('on_time_delivery: good ≥75%, watch 50–74%, alert <50%', () => {
    expect(computeTeamHealthDimensionLevel('on_time_delivery', 80)).toBe('good');
    expect(computeTeamHealthDimensionLevel('on_time_delivery', 75)).toBe('good');
    expect(computeTeamHealthDimensionLevel('on_time_delivery', 60)).toBe('watch');
    expect(computeTeamHealthDimensionLevel('on_time_delivery', 49)).toBe('alert');
  });

  it('work_quality: good <15%, watch 15–25%, alert >25%', () => {
    expect(computeTeamHealthDimensionLevel('work_quality', 10)).toBe('good');
    expect(computeTeamHealthDimensionLevel('work_quality', 20)).toBe('watch');
    expect(computeTeamHealthDimensionLevel('work_quality', 26)).toBe('alert');
  });

  it('capacity: good 70–110%, watch 111–130%, alert >130%', () => {
    expect(computeTeamHealthDimensionLevel('capacity', 90)).toBe('good');
    expect(computeTeamHealthDimensionLevel('capacity', 120)).toBe('watch');
    expect(computeTeamHealthDimensionLevel('capacity', 140)).toBe('alert');
    expect(computeTeamHealthDimensionLevel('capacity', 65)).toBe('watch');
  });

  it('dora: good for elite/high, watch for medium, alert for low', () => {
    expect(computeTeamHealthDimensionLevel('dora', 0, { doraLevel: 'elite' })).toBe('good');
    expect(computeTeamHealthDimensionLevel('dora', 0, { doraLevel: 'high' })).toBe('good');
    expect(computeTeamHealthDimensionLevel('dora', 0, { doraLevel: 'medium' })).toBe('watch');
    expect(computeTeamHealthDimensionLevel('dora', 0, { doraLevel: 'low' })).toBe('alert');
  });

  it('budget_burn: good <85%, watch 85–100%, alert >100%', () => {
    expect(computeTeamHealthDimensionLevel('budget_burn', 80)).toBe('good');
    expect(computeTeamHealthDimensionLevel('budget_burn', 95)).toBe('watch');
    expect(computeTeamHealthDimensionLevel('budget_burn', 101)).toBe('alert');
  });
});

// ── computeTeamOverallLevel ───────────────────────────────────────────────────

describe('computeTeamOverallLevel', () => {
  it('returns good when all good', () => {
    expect(computeTeamOverallLevel(['good', 'good'])).toBe('good');
  });

  it('returns watch when any watch', () => {
    expect(computeTeamOverallLevel(['good', 'watch', 'good'])).toBe('watch');
  });

  it('returns alert when any alert', () => {
    expect(computeTeamOverallLevel(['good', 'watch', 'alert'])).toBe('alert');
  });

  it('returns good for empty array', () => {
    expect(computeTeamOverallLevel([])).toBe('good');
  });
});

// ── computeLinearRegression ───────────────────────────────────────────────────

describe('computeLinearRegression', () => {
  it('returns zero slope and pValue=1 for fewer than 3 points', () => {
    const r = computeLinearRegression([0, 1], [10, 20]);
    expect(r.slope).toBe(0);
    expect(r.pValue).toBe(1);
  });

  it('fits a perfect positive slope', () => {
    // y = 2x + 1
    const xs = [0, 1, 2, 3, 4];
    const ys = [1, 3, 5, 7, 9];
    const r = computeLinearRegression(xs, ys);
    expect(r.slope).toBe(2);
    expect(r.rSquared).toBe(1);
    expect(r.intercept).toBe(1);
    expect(r.pValue).toBeLessThan(0.01);
  });

  it('fits a perfect negative slope', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [10, 8, 6, 4, 2];
    const r = computeLinearRegression(xs, ys);
    expect(r.slope).toBe(-2);
    expect(r.rSquared).toBe(1);
  });

  it('returns zero slope and rSquared=0 for constant y', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [5, 5, 5, 5, 5];
    const r = computeLinearRegression(xs, ys);
    expect(r.slope).toBe(0);
    expect(r.rSquared).toBe(0);
  });

  it('returns non-significant pValue for random noise', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [5, 3, 7, 2, 6]; // no clear trend
    const r = computeLinearRegression(xs, ys);
    expect(r.pValue).toBeGreaterThan(0.1);
  });
});

// ── computePercentile ─────────────────────────────────────────────────────────

describe('computePercentile', () => {
  it('returns 0 for empty array', () => {
    expect(computePercentile([], 50)).toBe(0);
  });

  it('returns sole element for single-element array', () => {
    expect(computePercentile([42], 50)).toBe(42);
  });

  it('returns median correctly', () => {
    expect(computePercentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it('returns min for p0 and max for p100', () => {
    const arr = [10, 20, 30, 40, 50];
    expect(computePercentile(arr, 0)).toBe(10);
    expect(computePercentile(arr, 100)).toBe(50);
  });

  it('interpolates for non-integer index', () => {
    const arr = [0, 10, 20, 30, 40];
    // p25: idx = 0.25 * 4 = 1 → exactly arr[1] = 10
    expect(computePercentile(arr, 25)).toBe(10);
    // p75: idx = 0.75 * 4 = 3 → exactly arr[3] = 30
    expect(computePercentile(arr, 75)).toBe(30);
  });
});
