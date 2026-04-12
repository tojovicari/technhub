import { describe, expect, it } from 'vitest';
import {
  forecastVelocity,
  forecastEpicCompletion,
  computeSlaRiskScore,
  detectAnomalies,
  generateRecommendations,
  computeCapacityUtilization,
  buildGanttEpicItem,
  computeDependencyStatuses
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
