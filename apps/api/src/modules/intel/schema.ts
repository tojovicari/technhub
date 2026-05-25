import { z } from 'zod';

// ── Shared period helpers (used across all schemas) ───────────────────────────
const periodRegex = /^(\d{4}-(Q[1-4]|\d{2})|current_quarter|current_month|last_quarter|last_month|last_[2-9]_quarters|last_1[0-2]_quarters)$/;
const periodMsg   = 'Use YYYY-Qn, YYYY-MM, current_quarter, current_month, last_quarter, last_month ou last_N_quarters (N=2..12)';

// ── Velocity forecast ─────────────────────────────────────────────────────────

export const velocityForecastQuerySchema = z.object({
  project_id:   z.string().uuid().optional(),
  team_id:      z.string().uuid().optional(),
  window_weeks: z.coerce.number().int().min(4).max(52).default(12)
});

// ── Epic completion forecast ──────────────────────────────────────────────────

export const epicForecastParamsSchema = z.object({
  epic_id: z.string().uuid()
});

// ── SLA risk ──────────────────────────────────────────────────────────────────

export const slaRiskQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  team_id:    z.string().uuid().optional(),
  limit:      z.coerce.number().int().min(1).max(100).default(20)
});

// ── Anomaly detection ─────────────────────────────────────────────────────────

export const anomaliesQuerySchema = z.object({
  metric_name:  z.string().optional(),
  project_id:   z.string().uuid().optional(),
  window_days:  z.coerce.number().int().min(7).max(365).default(90),
  z_threshold:  z.coerce.number().min(1).max(5).default(2.0)
});

// ── Recommendations ───────────────────────────────────────────────────────────

export const recommendationsQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  team_id:    z.string().uuid().optional()
});

// ── Capacity ──────────────────────────────────────────────────────────────────

export const capacityQuerySchema = z.object({
  period:               z.string().regex(periodRegex, periodMsg),
  team_id:              z.string().uuid().optional(),
  capacity_hours:       z.coerce.number().min(1).default(160) // hours per person per period
});

// ── Roadmap / Gantt (4.6) ─────────────────────────────────────────────────────

export const roadmapQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  team_id:    z.string().uuid().optional(),
  status:     z.enum(['backlog', 'active', 'completed', 'cancelled']).optional()
});

// ── Dependency tracking (4.7) ─────────────────────────────────────────────────

export const dependencyQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  epic_id:    z.string().uuid().optional()
});

// ── CSV/BI Export (4.10) ──────────────────────────────────────────────────────

export const exportQuerySchema = z.object({
  type:       z.enum(['tasks', 'epics', 'velocity', 'capacity', 'anomalies']),
  project_id: z.string().uuid().optional(),
  team_id:    z.string().uuid().optional(),
  period:     z.string().regex(periodRegex, periodMsg).optional()
});

// ── On-time delivery (v2.1) ───────────────────────────────────────────────────

export const onTimeDeliveryQuerySchema = z.object({
  project_id:     z.string().uuid().optional(),
  team_id:        z.string().uuid().optional(),
  priority:       z.enum(['P0', 'P1', 'P2', 'P3', 'P4']).optional(),
  task_type:      z.enum(['feature', 'bug', 'chore', 'spike', 'tech_debt']).optional(),
  period:         z.string().regex(periodRegex, periodMsg).optional(),
  compare_period: z.string().regex(periodRegex, periodMsg).optional()
});

// ── Work mix (v2.2) ───────────────────────────────────────────────────────────

export const workMixQuerySchema = z.object({
  project_id:     z.string().uuid().optional(),
  team_id:        z.string().uuid().optional(),
  period:         z.string().regex(periodRegex, periodMsg).optional(),
  compare_period: z.string().regex(periodRegex, periodMsg).optional()
});

// ── Rework rate (v2.3) ────────────────────────────────────────────────────────

export const reworkRateQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  team_id:    z.string().uuid().optional(),
  period:     z.string().regex(periodRegex, periodMsg).optional()
});

// ── Estimation accuracy (v2.4) ────────────────────────────────────────────────

export const estimationAccuracyQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  team_id:    z.string().uuid().optional(),
  period:     z.string().regex(periodRegex, periodMsg).optional()
});

// ── Key person risk (v2.5) ────────────────────────────────────────────────────

export const keyPersonRiskQuerySchema = z.object({
  project_id:                      z.string().uuid().optional(),
  team_id:                         z.string().uuid().optional(),
  concentration_threshold_percent: z.coerce.number().min(10).max(80).default(30)
});

// ── Team health (v2.6) ────────────────────────────────────────────────────────

export const teamHealthQuerySchema = z.object({
  team_id: z.string().uuid().optional(),
  period:  z.string().regex(periodRegex, periodMsg).optional()
});

// ── Incident patterns (v2.7) ──────────────────────────────────────────────────

export const incidentPatternsQuerySchema = z.object({
  project_id:     z.string().uuid().optional(),
  period:         z.string().regex(periodRegex, periodMsg).optional(),
  compare_period: z.string().regex(periodRegex, periodMsg).optional()
});

// ── Deploy quality (v2.8) ─────────────────────────────────────────────────────

export const deployQualityQuerySchema = z.object({
  project_id:            z.string().uuid().optional(),
  window_days:           z.coerce.number().int().min(7).max(365).default(90),
  incident_window_hours: z.coerce.number().int().min(1).max(72).default(24)
});

// ── SLA suggestions (v2.9) ────────────────────────────────────────────────────

export const slaSuggestionsQuerySchema = z.object({
  project_id:        z.string().uuid().optional(),
  team_id:           z.string().uuid().optional(),
  min_sample_size:   z.coerce.number().int().min(5).max(50).default(10),
  target_percentile: z.coerce
    .number()
    .refine(v => [50, 75, 90, 95].includes(v), { message: 'Must be one of: 50, 75, 90, 95' })
    .default(75),
  window_days:       z.coerce.number().int().min(30).max(365).default(180)
});

// ── Trend degradation (v2.10) ─────────────────────────────────────────────────

export const trendDegradationQuerySchema = z.object({
  project_id:             z.string().uuid().optional(),
  team_id:                z.string().uuid().optional(),
  window_days:            z.coerce.number().int().min(30).max(365).default(90),
  min_points:             z.coerce.number().int().min(3).max(20).default(5),
  significance_threshold: z.coerce.number().min(0.01).max(0.20).default(0.05)
});
