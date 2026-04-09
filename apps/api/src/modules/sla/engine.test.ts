import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateCondition, computeSlaStatus, isTaskTerminal, isTaskActive } from './engine.js';
import type { SlaConditionGroup } from './schema.js';
import type { SlaTaskEvent } from './schema.js';

// ── Engine: evaluateCondition ────────────────────────────────────────────────

describe('evaluateCondition', () => {
  it('AND: all rules must match', () => {
    const condition: SlaConditionGroup = {
      operator: 'AND',
      rules: [
        { field: 'task_type', op: 'in', value: ['bug'] },
        { field: 'priority', op: 'in', value: ['P0', 'P1'] }
      ]
    };
    expect(evaluateCondition(condition, { task_type: 'bug', priority: 'P0' })).toBe(true);
    expect(evaluateCondition(condition, { task_type: 'bug', priority: 'P2' })).toBe(false);
    expect(evaluateCondition(condition, { task_type: 'feature', priority: 'P0' })).toBe(false);
  });

  it('OR: at least one rule must match', () => {
    const condition: SlaConditionGroup = {
      operator: 'OR',
      rules: [
        { field: 'task_type', op: 'eq', value: 'bug' },
        { field: 'priority', op: 'eq', value: 'P0' }
      ]
    };
    expect(evaluateCondition(condition, { task_type: 'feature', priority: 'P0' })).toBe(true);
    expect(evaluateCondition(condition, { task_type: 'bug', priority: 'P3' })).toBe(true);
    expect(evaluateCondition(condition, { task_type: 'feature', priority: 'P2' })).toBe(false);
  });

  it('nested conditions', () => {
    const condition: SlaConditionGroup = {
      operator: 'AND',
      rules: [
        { field: 'task_type', op: 'eq', value: 'bug' },
        {
          operator: 'OR',
          rules: [
            { field: 'priority', op: 'eq', value: 'P0' },
            { field: 'labels', op: 'contains', value: 'production' }
          ]
        }
      ]
    };
    expect(
      evaluateCondition(condition, { task_type: 'bug', priority: 'P2', labels: ['production'] })
    ).toBe(true);
    expect(
      evaluateCondition(condition, { task_type: 'bug', priority: 'P0', labels: [] })
    ).toBe(true);
    expect(
      evaluateCondition(condition, { task_type: 'bug', priority: 'P2', labels: [] })
    ).toBe(false);
  });

  it('contains: checks array membership', () => {
    const condition: SlaConditionGroup = {
      operator: 'AND',
      rules: [{ field: 'labels', op: 'contains', value: ['hotfix', 'sev1'] }]
    };
    expect(evaluateCondition(condition, { labels: ['hotfix', 'backend'] })).toBe(true);
    expect(evaluateCondition(condition, { labels: ['sev2', 'backend'] })).toBe(false);
  });

  it('gte / lte: numeric comparison', () => {
    const gte: SlaConditionGroup = {
      operator: 'AND',
      rules: [{ field: 'story_points', op: 'gte', value: 5 }]
    };
    expect(evaluateCondition(gte, { story_points: 8 })).toBe(true);
    expect(evaluateCondition(gte, { story_points: 3 })).toBe(false);
  });
});

// ── Engine: computeSlaStatus ────────────────────────────────────────────────

describe('computeSlaStatus', () => {
  it('returns running when below warning threshold', () => {
    const startedAt = new Date('2026-01-01T10:00:00Z');
    const now = new Date('2026-01-01T10:30:00Z'); // 30 min elapsed, target 120, warning 80%
    const result = computeSlaStatus(startedAt, 120, 80, now);
    expect(result.status).toBe('running');
    expect(result.elapsed_minutes).toBe(30);
    expect(result.breach_minutes).toBeNull();
  });

  it('returns at_risk when past warning threshold', () => {
    const startedAt = new Date('2026-01-01T10:00:00Z');
    const now = new Date('2026-01-01T11:40:00Z'); // 100 min elapsed, 80% of 120 = 96 min
    const result = computeSlaStatus(startedAt, 120, 80, now);
    expect(result.status).toBe('at_risk');
    expect(result.breach_minutes).toBeNull();
  });

  it('returns breached when past target', () => {
    const startedAt = new Date('2026-01-01T10:00:00Z');
    const now = new Date('2026-01-01T12:10:00Z'); // 130 min elapsed, target 120
    const result = computeSlaStatus(startedAt, 120, 80, now);
    expect(result.status).toBe('breached');
    expect(result.breach_minutes).toBe(10);
  });

  it('deadline_at is startedAt + target_minutes', () => {
    const startedAt = new Date('2026-01-01T10:00:00Z');
    const result = computeSlaStatus(startedAt, 60, 80, new Date('2026-01-01T10:10:00Z'));
    expect(result.deadline_at).toEqual(new Date('2026-01-01T11:00:00Z'));
  });

  it('disables at_risk when warning_at_percent is 0', () => {
    const startedAt = new Date('2026-01-01T10:00:00Z');
    const now = new Date('2026-01-01T10:59:00Z'); // 59 min, target 60, warningPercent 0
    const result = computeSlaStatus(startedAt, 60, 0, now);
    expect(result.status).toBe('running');
  });
});

// ── Engine: terminal / active helpers ────────────────────────────────────────

describe('isTaskTerminal / isTaskActive', () => {
  const base: SlaTaskEvent = {
    task_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    tenant_id: 'ten_test',
    task_type: 'bug',
    priority: 'P1',
    status: 'in_progress',
    labels: []
  };

  it.each(['done', 'cancelled'] as const)('considers %s as terminal', (status) => {
    expect(isTaskTerminal({ ...base, status })).toBe(true);
  });

  it.each(['backlog', 'todo', 'in_progress', 'review'] as const)(
    'does not consider %s as terminal',
    (status) => {
      expect(isTaskTerminal({ ...base, status })).toBe(false);
    }
  );

  it.each(['in_progress', 'review'] as const)('considers %s as active', (status) => {
    expect(isTaskActive({ ...base, status })).toBe(true);
  });

  it.each(['backlog', 'todo', 'done', 'cancelled'] as const)(
    'does not consider %s as active',
    (status) => {
      expect(isTaskActive({ ...base, status })).toBe(false);
    }
  );
});
