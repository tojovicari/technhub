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

const policyMappingEntrySchema = z.object({
  provider: z.string().min(1).max(64),
  source_type: z.string().min(1).max(64),
  match: z.string().min(1).max(240)
});

const policyStateMappingSchema = z.object({
  backlog: z.array(policyMappingEntrySchema).optional().default([]),
  planned: z.array(policyMappingEntrySchema).optional().default([]),
  in_progress: z.array(policyMappingEntrySchema).optional().default([]),
  paused: z.array(policyMappingEntrySchema).optional().default([]),
  done: z.array(policyMappingEntrySchema).optional().default([]),
  cancelled: z.array(policyMappingEntrySchema).optional().default([])
});

const deliverySourceSchema = z.enum(['task_done', 'pr_merged', 'release_deploy']);

const policyDeliverySchema = z.object({
  sources: z.array(deliverySourceSchema).min(1),
  aggregation_mode: z.enum(['single', 'any_of', 'weighted', 'priority_order']),
  weights: z.record(z.string(), z.number().positive()).optional(),
  priority_order: z.array(deliverySourceSchema).optional(),
  dedup: z.object({
    enabled: z.boolean().optional().default(true),
    key_strategy: z.string().min(1).max(120).optional().default('task_source_or_pr_or_release')
  }).optional().default({ enabled: true, key_strategy: 'task_source_or_pr_or_release' })
});

const policyMetricTuningSchema = z.object({
  overview: z.object({
    incident_penalty_cap: z.number().min(0).max(100).optional(),
    throughput_penalty_down: z.number().min(0).max(100).optional(),
    throughput_penalty_stable: z.number().min(0).max(100).optional()
  }).optional(),
  backlog_quality: z.object({
    weights: z.object({
      stale_backlog_rate: z.number().min(0).max(100),
      overdue_backlog_rate: z.number().min(0).max(100),
      flow_regression_rate: z.number().min(0).max(100),
      backlog_churn_proxy: z.number().min(0).max(100)
    }).optional()
  }).optional()
}).optional();

export const insightsCalculationPolicyConfigSchema = z.object({
  state_mapping: policyStateMappingSchema,
  delivery: policyDeliverySchema,
  metric_tuning: policyMetricTuningSchema
});

export const insightsCalculationPolicyGetQuerySchema = z.object({
  at: z.coerce.date().optional()
});

export const insightsCalculationPolicyPutBodySchema = z.object({
  name: z.string().min(3).max(120),
  config: insightsCalculationPolicyConfigSchema
});

export const insightsCalculationPolicyPublishBodySchema = z
  .object({
    draft_id: z.string().uuid(),
    effective_from: z.coerce.date().optional(),
    effective_to: z.coerce.date().optional()
  })
  .superRefine((value, ctx) => {
    if (value.effective_from && value.effective_to && value.effective_to < value.effective_from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'effective_to must be greater than or equal to effective_from',
        path: ['effective_to']
      });
    }
  });

export const insightsCalculationPolicyHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  include_defaults: z.coerce.boolean().optional().default(false)
});

export type InsightsOverviewQuery = z.infer<typeof insightsOverviewQuerySchema>;
export type InsightsIncidentsQuery = z.infer<typeof insightsIncidentsQuerySchema>;
export type InsightsPlanningConfidenceQuery = z.infer<typeof insightsPlanningConfidenceQuerySchema>;
export type InsightsBacklogQualityQuery = z.infer<typeof insightsBacklogQualityQuerySchema>;
export type InsightsTrendsQuery = z.infer<typeof insightsTrendsQuerySchema>;
export type InsightsRecomputeBody = z.infer<typeof insightsRecomputeBodySchema>;
export type InsightsCalculationPolicyConfig = z.infer<typeof insightsCalculationPolicyConfigSchema>;
export type InsightsCalculationPolicyGetQuery = z.infer<typeof insightsCalculationPolicyGetQuerySchema>;
export type InsightsCalculationPolicyPutBody = z.infer<typeof insightsCalculationPolicyPutBodySchema>;
export type InsightsCalculationPolicyPublishBody = z.infer<typeof insightsCalculationPolicyPublishBodySchema>;
export type InsightsCalculationPolicyHistoryQuery = z.infer<typeof insightsCalculationPolicyHistoryQuerySchema>;
