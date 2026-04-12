import { z } from 'zod';

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
  period:               z.string().regex(/^\d{4}-(Q[1-4]|\d{2})$/, 'Use YYYY-Qn or YYYY-MM'),
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
  period:     z.string().regex(/^\d{4}-(Q[1-4]|\d{2})$/, 'Use YYYY-Qn or YYYY-MM').optional()
});
