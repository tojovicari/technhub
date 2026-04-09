import { describe, expect, it } from 'vitest';
import {
  classifyDeploymentFrequency,
  computeDeploymentFrequency,
  classifyLeadTime,
  computeLeadTime,
  classifyMttr,
  computeMttr,
  classifyChangeFailureRate,
  computeChangeFailureRate,
  computeOverallDoraLevel
} from './engine.js';

// ── classifyDeploymentFrequency ───────────────────────────────────────────────

describe('classifyDeploymentFrequency', () => {
  it('elite: >= 1 deploy per day', () => {
    expect(classifyDeploymentFrequency(1)).toBe('elite');
    expect(classifyDeploymentFrequency(2)).toBe('elite');
  });

  it('high: >= 1 deploy per 7 days', () => {
    expect(classifyDeploymentFrequency(1 / 7)).toBe('high');
    expect(classifyDeploymentFrequency(0.99)).toBe('high');
  });

  it('medium: >= 1 deploy per 30 days', () => {
    expect(classifyDeploymentFrequency(1 / 30)).toBe('medium');
    expect(classifyDeploymentFrequency(1 / 8)).toBe('medium');
  });

  it('low: < 1 deploy per 30 days', () => {
    expect(classifyDeploymentFrequency(0)).toBe('low');
    expect(classifyDeploymentFrequency(1 / 31)).toBe('low');
  });
});

// ── computeDeploymentFrequency ────────────────────────────────────────────────

describe('computeDeploymentFrequency', () => {
  it('computes value and correct level', () => {
    const result = computeDeploymentFrequency(30, 30);
    expect(result.value).toBe(1);
    expect(result.unit).toBe('per_day');
    expect(result.level).toBe('elite');
  });

  it('handles 0 deploys', () => {
    const result = computeDeploymentFrequency(0, 30);
    expect(result.value).toBe(0);
    expect(result.level).toBe('low');
  });

  it('partial frequency rounds correctly', () => {
    const result = computeDeploymentFrequency(2, 30);
    expect(result.level).toBe('medium'); // 2/30 = 0.067, < 1/7
  });
});

// ── classifyLeadTime ──────────────────────────────────────────────────────────

describe('classifyLeadTime', () => {
  it('elite: < 1 hour', () => {
    expect(classifyLeadTime(0.5)).toBe('elite');
    expect(classifyLeadTime(0)).toBe('elite');
  });

  it('high: < 7 days (168 h)', () => {
    expect(classifyLeadTime(1)).toBe('high');
    expect(classifyLeadTime(167)).toBe('high');
  });

  it('medium: < 30 days (720 h)', () => {
    expect(classifyLeadTime(168)).toBe('medium');
    expect(classifyLeadTime(719)).toBe('medium');
  });

  it('low: >= 30 days', () => {
    expect(classifyLeadTime(720)).toBe('low');
    expect(classifyLeadTime(1000)).toBe('low');
  });
});

// ── computeLeadTime ───────────────────────────────────────────────────────────

describe('computeLeadTime', () => {
  it('returns null for empty array', () => {
    expect(computeLeadTime([])).toBeNull();
  });

  it('returns correct p50 and p95', () => {
    const hours = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = computeLeadTime(hours)!;
    expect(result.p50).toBeCloseTo(5.5, 1);
    expect(result.p95).toBeGreaterThan(result.p50);
    expect(result.unit).toBe('hours');
  });

  it('single value: p50 = p95 = that value', () => {
    const result = computeLeadTime([0.5])!;
    expect(result.p50).toBe(0.5);
    expect(result.p95).toBe(0.5);
    expect(result.level).toBe('elite');
  });
});

// ── classifyMttr ──────────────────────────────────────────────────────────────

describe('classifyMttr', () => {
  it('elite: < 1 hour', () => {
    expect(classifyMttr(0.5)).toBe('elite');
  });

  it('high: < 24 hours', () => {
    expect(classifyMttr(1)).toBe('high');
    expect(classifyMttr(23)).toBe('high');
  });

  it('medium: < 7 days (168 h)', () => {
    expect(classifyMttr(24)).toBe('medium');
    expect(classifyMttr(167)).toBe('medium');
  });

  it('low: >= 7 days', () => {
    expect(classifyMttr(168)).toBe('low');
  });
});

// ── computeMttr ───────────────────────────────────────────────────────────────

describe('computeMttr', () => {
  it('returns null for empty array', () => {
    expect(computeMttr([])).toBeNull();
  });

  it('computes median restore time', () => {
    const result = computeMttr([0.5, 0.5, 0.5])!;
    expect(result.value).toBeCloseTo(0.5, 5);
    expect(result.unit).toBe('hours');
    expect(result.level).toBe('elite');
  });

  it('high level for 12h median', () => {
    const result = computeMttr([12, 12, 12])!;
    expect(result.level).toBe('high');
  });
});

// ── classifyChangeFailureRate ─────────────────────────────────────────────────

describe('classifyChangeFailureRate', () => {
  it('elite: <= 5%', () => {
    expect(classifyChangeFailureRate(0)).toBe('elite');
    expect(classifyChangeFailureRate(5)).toBe('elite');
  });

  it('high: <= 10%', () => {
    expect(classifyChangeFailureRate(6)).toBe('high');
    expect(classifyChangeFailureRate(10)).toBe('high');
  });

  it('medium: <= 15%', () => {
    expect(classifyChangeFailureRate(11)).toBe('medium');
    expect(classifyChangeFailureRate(15)).toBe('medium');
  });

  it('low: > 15%', () => {
    expect(classifyChangeFailureRate(16)).toBe('low');
  });
});

// ── computeChangeFailureRate ──────────────────────────────────────────────────

describe('computeChangeFailureRate', () => {
  it('returns null when 0 total deploys', () => {
    expect(computeChangeFailureRate(0, 0)).toBeNull();
  });

  it('computes 0% with no failures', () => {
    const result = computeChangeFailureRate(10, 0)!;
    expect(result.value).toBe(0);
    expect(result.level).toBe('elite');
    expect(result.unit).toBe('percent');
  });

  it('computes 20% failure rate', () => {
    const result = computeChangeFailureRate(10, 2)!;
    expect(result.value).toBe(20);
    expect(result.level).toBe('low');
  });
});

// ── computeOverallDoraLevel ───────────────────────────────────────────────────

describe('computeOverallDoraLevel', () => {
  it('all elite → elite', () => {
    expect(computeOverallDoraLevel(['elite', 'elite', 'elite', 'elite'])).toBe('elite');
  });

  it('all low → low', () => {
    expect(computeOverallDoraLevel(['low', 'low'])).toBe('low');
  });

  it('mixed → intermediate level', () => {
    const result = computeOverallDoraLevel(['elite', 'high', 'medium', 'low']);
    // avg rank = (4+3+2+1)/4 = 2.5 → rounds to medium (2) or high (3)
    expect(['medium', 'high']).toContain(result);
  });

  it('single level preserved', () => {
    expect(computeOverallDoraLevel(['high'])).toBe('high');
  });
});
