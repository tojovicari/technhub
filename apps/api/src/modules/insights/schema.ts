import { z } from 'zod';

export const insightsResourceGroupParamsSchema = z.object({
  group_id: z.string().uuid()
});

export const insightsSquadParamsSchema = z.object({
  squad_id: z.string().uuid()
});

export const insightsSquadRunParamsSchema = insightsSquadParamsSchema.extend({
  run_id: z.string().uuid()
});

export const insightsSquadInsightParamsSchema = insightsSquadParamsSchema.extend({
  insight_id: z.string().uuid()
});

export const insightsSquadScopeParamsSchema = insightsSquadParamsSchema.extend({
  scope_id: z.string().uuid()
});

export const insightsSquadClassifierParamsSchema = insightsSquadParamsSchema.extend({
  classifier_id: z.string().uuid()
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

export const insightsFieldCatalogQuerySchema = z.object({
  provider: z.enum(['jira', 'github', 'opsgenie', 'incident_io']).optional(),
  entity_type: z.string().min(1).max(64).optional(),
  fact_type: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50)
});

const insightsMetricFilterSchema = z.object({
  field: z.string().min(1).max(120),
  operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte']).optional(),
  value: z.unknown().optional()
});

export const insightsMetricFormulaConfigSchema: z.ZodType<{
  kind: 'count' | 'sum' | 'average' | 'ratio' | 'difference';
  source: 'classification_results';
  field?: string;
  filters?: Array<{ field: string; operator?: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte'; value?: unknown }>;
  numerator?: unknown;
  denominator?: unknown;
  left?: unknown;
  right?: unknown;
}> = z.lazy(() => z.object({
  kind: z.enum(['count', 'sum', 'average', 'ratio', 'difference']),
  source: z.literal('classification_results'),
  field: z.string().min(1).max(120).optional(),
  filters: z.array(insightsMetricFilterSchema).optional(),
  numerator: insightsMetricFormulaConfigSchema.optional(),
  denominator: insightsMetricFormulaConfigSchema.optional(),
  left: insightsMetricFormulaConfigSchema.optional(),
  right: insightsMetricFormulaConfigSchema.optional()
}));

export const insightsFormulaListQuerySchema = z.object({
  status: z.enum(['draft', 'active', 'archived']).optional(),
  key: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50)
});

export const insightsFormulaCreateBodySchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(3).max(120),
  description: z.string().max(500).optional(),
  unit: z.string().min(1).max(32),
  window_days: z.coerce.number().int().min(1).max(365).optional().default(30),
  config: insightsMetricFormulaConfigSchema
});

export const insightsFormulaPublishParamsSchema = insightsSquadParamsSchema.extend({
  formula_id: z.string().uuid()
});

export const insightsFormulaPublishBodySchema = z.object({
  status: z.literal('active').optional().default('active')
});

export const insightsFormulaSimulateBodySchema = z.object({
  key: z.string().min(1).max(64).optional().default('simulation'),
  name: z.string().min(3).max(120),
  unit: z.string().min(1).max(32),
  window_days: z.coerce.number().int().min(1).max(365).optional().default(30),
  window_start: z.coerce.date().optional(),
  window_end: z.coerce.date().optional(),
  config: insightsMetricFormulaConfigSchema
}).superRefine((value, ctx) => {
  if (value.window_start && value.window_end && value.window_end < value.window_start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'window_end must be greater than or equal to window_start',
      path: ['window_end']
    });
  }
});

export const insightsMaterializedQuerySchema = z.object({
  metric_key: z.string().min(1).max(64).optional(),
  window_start: z.coerce.date().optional(),
  window_end: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50)
}).superRefine((value, ctx) => {
  if (value.window_start && value.window_end && value.window_end < value.window_start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'window_end must be greater than or equal to window_start',
      path: ['window_end']
    });
  }
});

export const insightsSquadRecomputeBodySchema = z.object({
  window_days: z.coerce.number().int().min(1).max(365).optional().default(30),
  reason: z.string().max(240).optional()
});

export const insightsScopeListQuerySchema = z.object({
  status: z.enum(['draft', 'active', 'archived']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50)
});

export const insightsScopeConfigSchema = z.object({
  providers: z.array(z.enum(['jira', 'github', 'opsgenie', 'incident_io'])).optional(),
  entity_types: z.array(z.string().min(1).max(64)).optional(),
  fact_types: z.array(z.string().min(1).max(64)).optional(),
  required_attributes: z.array(z.string().min(1).max(120)).optional(),
  excluded_attributes: z.array(z.string().min(1).max(120)).optional()
});

export const insightsScopeCreateBodySchema = z.object({
  name: z.string().min(3).max(120),
  config: insightsScopeConfigSchema
});

const insightsClassifierConditionSchema = z.object({
  field: z.string().min(1).max(120),
  operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte']),
  value: z.unknown()
});

export const insightsClassifierListQuerySchema = z.object({
  status: z.enum(['draft', 'active', 'archived']).optional(),
  key: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50)
});

export const insightsClassifierCreateBodySchema = z.object({
  key: z.string().min(1).max(64),
  applies_to_fact_type: z.string().min(1).max(64),
  config: z.object({
    applies_to: z.array(z.string().min(1).max(64)).optional(),
    rule: z.object({
      any: z.array(insightsClassifierConditionSchema).optional(),
      all: z.array(insightsClassifierConditionSchema).optional(),
      not: insightsClassifierConditionSchema.optional()
    })
  })
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
export type InsightsFieldCatalogQuery = z.infer<typeof insightsFieldCatalogQuerySchema>;
export type InsightsFormulaListQuery = z.infer<typeof insightsFormulaListQuerySchema>;
export type InsightsFormulaCreateBody = z.infer<typeof insightsFormulaCreateBodySchema>;
export type InsightsFormulaPublishBody = z.infer<typeof insightsFormulaPublishBodySchema>;
export type InsightsFormulaSimulateBody = z.infer<typeof insightsFormulaSimulateBodySchema>;
export type InsightsMaterializedQuery = z.infer<typeof insightsMaterializedQuerySchema>;
export type InsightsSquadRecomputeBody = z.infer<typeof insightsSquadRecomputeBodySchema>;
export type InsightsScopeListQuery = z.infer<typeof insightsScopeListQuerySchema>;
export type InsightsScopeCreateBody = z.infer<typeof insightsScopeCreateBodySchema>;
export type InsightsClassifierListQuery = z.infer<typeof insightsClassifierListQuerySchema>;
export type InsightsClassifierCreateBody = z.infer<typeof insightsClassifierCreateBodySchema>;
export type InsightsCalculationPolicyConfig = z.infer<typeof insightsCalculationPolicyConfigSchema>;
export type InsightsCalculationPolicyGetQuery = z.infer<typeof insightsCalculationPolicyGetQuerySchema>;
export type InsightsCalculationPolicyPutBody = z.infer<typeof insightsCalculationPolicyPutBodySchema>;
export type InsightsCalculationPolicyPublishBody = z.infer<typeof insightsCalculationPolicyPublishBodySchema>;
export type InsightsCalculationPolicyHistoryQuery = z.infer<typeof insightsCalculationPolicyHistoryQuerySchema>;
