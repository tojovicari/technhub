import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────────
// DORA level thresholds
// ────────────────────────────────────────────────────────────────────────────────

export type DoraLevel = 'elite' | 'high' | 'medium' | 'low';

// ── Deployment Frequency ──────────────────────────────────────────────────────

// deploys per day
export function classifyDeploymentFrequency(deploysPerDay: number): DoraLevel {
  if (deploysPerDay >= 1) return 'elite';       // multiple per day or ≥1/day
  if (deploysPerDay >= 1 / 7) return 'high';    // between 1/week and 1/day
  if (deploysPerDay >= 1 / 30) return 'medium'; // between 1/month and 1/week
  return 'low';
}

export function computeDeploymentFrequency(
  deployCount: number,
  windowDays: number
): { value: number; unit: 'per_day'; level: DoraLevel } {
  const value = deployCount / windowDays;
  return { value, unit: 'per_day', level: classifyDeploymentFrequency(value) };
}

// ── Lead Time for Changes ─────────────────────────────────────────────────────

// hours
export function classifyLeadTime(hours: number): DoraLevel {
  if (hours < 1) return 'elite';
  if (hours < 7 * 24) return 'high';   // < 1 week
  if (hours < 30 * 24) return 'medium'; // < 1 month
  return 'low';
}

export function computeLeadTime(
  leadTimesHours: number[]
): { p50: number; p95: number; unit: 'hours'; level: DoraLevel } | null {
  if (leadTimesHours.length === 0) return null;

  const sorted = [...leadTimesHours].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);

  return {
    p50,
    p95,
    unit: 'hours',
    level: classifyLeadTime(p50)
  };
}

// ── Mean Time to Restore ──────────────────────────────────────────────────────

// hours
export function classifyMttr(hours: number): DoraLevel {
  if (hours < 1) return 'elite';
  if (hours < 24) return 'high';         // < 1 day
  if (hours < 7 * 24) return 'medium';  // < 1 week
  return 'low';
}

export function computeMttr(
  restoreTimesHours: number[]
): { value: number; unit: 'hours'; level: DoraLevel } | null {
  if (restoreTimesHours.length === 0) return null;

  const sorted = [...restoreTimesHours].sort((a, b) => a - b);
  const value = percentile(sorted, 50);

  return { value, unit: 'hours', level: classifyMttr(value) };
}

// ── Change Failure Rate ───────────────────────────────────────────────────────

// percent (0–100)
export function classifyChangeFailureRate(percent: number): DoraLevel {
  if (percent <= 5) return 'elite';
  if (percent <= 10) return 'high';
  if (percent <= 15) return 'medium';
  return 'low';
}

export function computeChangeFailureRate(
  totalDeploys: number,
  failedDeploys: number
): { value: number; unit: 'percent'; level: DoraLevel } | null {
  if (totalDeploys === 0) return null;

  const value = (failedDeploys / totalDeploys) * 100;
  return { value, unit: 'percent', level: classifyChangeFailureRate(value) };
}

// ── Scorecard ─────────────────────────────────────────────────────────────────

const LEVEL_RANK: Record<DoraLevel, number> = {
  elite: 4,
  high: 3,
  medium: 2,
  low: 1
};

export function computeOverallDoraLevel(levels: DoraLevel[]): DoraLevel {
  if (levels.length === 0) return 'low';

  const avg = levels.reduce((sum, l) => sum + LEVEL_RANK[l], 0) / levels.length;

  if (avg >= 3.5) return 'elite';
  if (avg >= 2.5) return 'high';
  if (avg >= 1.5) return 'medium';
  return 'low';
}

// ── Mean Time to Acknowledge (MTTA) ──────────────────────────────────────────
// Health metric (not an official DORA metric). Measures on-call response speed.

// hours
export function classifyMtta(hours: number): DoraLevel {
  if (hours < 0.25) return 'elite';   // < 15 min
  if (hours < 0.5) return 'high';    // < 30 min
  if (hours < 2) return 'medium';    // < 2 h
  return 'low';
}

export function computeMtta(
  ackTimesHours: number[]
): { p50: number; unit: 'hours'; level: DoraLevel } | null {
  if (ackTimesHours.length === 0) return null;

  const sorted = [...ackTimesHours].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);

  return { p50, unit: 'hours', level: classifyMtta(p50) };
}

// ── Incident Frequency ────────────────────────────────────────────────────────
// P1/P2 incidents per day. Health metric, complements CFR.

export function computeIncidentFrequency(
  incidentCount: number,
  windowDays: number
): { value: number; unit: 'per_day' } {
  return { value: incidentCount / windowDays, unit: 'per_day' };
}

// ── Utility ───────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
