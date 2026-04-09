import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────────
// Condition DSL
// ────────────────────────────────────────────────────────────────────────────────

const slaRuleSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'in', 'contains', 'any', 'gte', 'lte']),
  value: z.union([z.string(), z.number(), z.array(z.string())])
});

export type SlaRule = z.infer<typeof slaRuleSchema>;

export const slaConditionSchema: z.ZodType<SlaConditionGroup> = z.lazy(() =>
  z.object({
    operator: z.enum(['AND', 'OR']),
    rules: z.array(z.union([slaRuleSchema, slaConditionSchema]))
  })
);

export type SlaConditionGroup = {
  operator: 'AND' | 'OR';
  rules: Array<SlaRule | SlaConditionGroup>;
};

// ────────────────────────────────────────────────────────────────────────────────
// Rules & Escalation
// ────────────────────────────────────────────────────────────────────────────────

const slaRuleEntrySchema = z.object({
  target_minutes: z.number().int().positive(),
  warning_at_percent: z.number().int().min(0).max(100)
});

export const slaPriorityRulesSchema = z.record(
  z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
  slaRuleEntrySchema
);

const escalationNotifySchema = z.object({
  notify: z.array(z.string()),
  create_incident: z.boolean().optional()
});

export const slaEscalationRuleSchema = z
  .object({
    at_risk: escalationNotifySchema.optional(),
    breached: escalationNotifySchema.optional()
  })
  .optional();

// ────────────────────────────────────────────────────────────────────────────────
// CRUD schemas
// ────────────────────────────────────────────────────────────────────────────────

export const createSlaTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  condition: slaConditionSchema,
  priority: z.number().int().default(100),
  applies_to: z.array(z.enum(['feature', 'bug', 'chore', 'spike', 'tech_debt'])).min(1),
  rules: slaPriorityRulesSchema,
  escalation_rule: slaEscalationRuleSchema,
  project_ids: z.array(z.string().uuid()).optional().default([]),
  is_default: z.boolean().optional().default(false)
});

export const updateSlaTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  condition: slaConditionSchema.optional(),
  priority: z.number().int().optional(),
  applies_to: z.array(z.enum(['feature', 'bug', 'chore', 'spike', 'tech_debt'])).optional(),
  rules: slaPriorityRulesSchema.optional(),
  escalation_rule: slaEscalationRuleSchema,
  project_ids: z.array(z.string().uuid()).optional(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional()
});

export const listSlaTemplatesQuerySchema = z.object({
  is_active: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().uuid().optional()
});

export const listSlaInstancesQuerySchema = z.object({
  task_id: z.string().uuid().optional(),
  status: z.enum(['running', 'met', 'at_risk', 'breached', 'superseded']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().uuid().optional()
});

// Task event consumed by the SLA engine (internal use / tests)
export const slaTaskEventSchema = z.object({
  task_id: z.string().uuid(),
  tenant_id: z.string().min(1),
  task_type: z.enum(['feature', 'bug', 'chore', 'spike', 'tech_debt']),
  priority: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
  status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled']),
  started_at: z.string().datetime().optional(),
  labels: z.array(z.string()).optional().default([]),
  component: z.string().optional(),
  project_id: z.string().uuid().optional(),
  source: z.enum(['jira', 'github', 'manual']).optional()
});

export type SlaTaskEvent = z.infer<typeof slaTaskEventSchema>;
