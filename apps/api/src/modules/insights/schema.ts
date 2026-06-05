import { z } from 'zod';

export const insightsResourceGroupParamsSchema = z.object({
  group_id: z.string().uuid()
});

export const insightsOverviewQuerySchema = z.object({
  window_days: z.coerce.number().int().min(7).max(180).optional().default(30)
});

export const insightsIncidentsQuerySchema = z.object({
  period: z
    .string()
    .regex(/^(\d{4}-\d{2}|\d{4}-Q[1-4])$/, 'period must be YYYY-MM or YYYY-Qn')
    .optional()
});

export const insightsPlanningConfidenceQuerySchema = z.object({
  period: z
    .string()
    .regex(/^(\d{4}-\d{2}|\d{4}-Q[1-4])$/, 'period must be YYYY-MM or YYYY-Qn')
    .optional()
});

export const insightsBacklogQualityQuerySchema = z.object({
  stale_days: z.coerce.number().int().min(7).max(120).optional().default(21)
});

export const insightsTrendsQuerySchema = z.object({
  window_days: z.coerce.number().int().min(14).max(180).optional().default(60),
  granularity: z.enum(['daily', 'weekly']).optional().default('weekly')
});

export const insightsRecomputeParamsSchema = insightsResourceGroupParamsSchema;

export const insightsRecomputeBodySchema = z.object({
  mode: z.enum(['full', 'incremental']).optional().default('incremental'),
  reason: z.string().max(240).optional()
});

export type InsightsOverviewQuery = z.infer<typeof insightsOverviewQuerySchema>;
export type InsightsIncidentsQuery = z.infer<typeof insightsIncidentsQuerySchema>;
export type InsightsPlanningConfidenceQuery = z.infer<typeof insightsPlanningConfidenceQuerySchema>;
export type InsightsBacklogQualityQuery = z.infer<typeof insightsBacklogQualityQuerySchema>;
export type InsightsTrendsQuery = z.infer<typeof insightsTrendsQuerySchema>;
export type InsightsRecomputeBody = z.infer<typeof insightsRecomputeBodySchema>;
