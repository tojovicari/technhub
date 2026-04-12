import { z } from 'zod';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const cogsCategorySchema = z.enum([
  'engineering',
  'overhead',
  'tooling',
  'cloud',
  'administrative',
  'other'
]);

export const cogsSourceSchema = z.enum([
  'timetracking',
  'story_points',
  'estimate',
  'manual'
]);

export const cogsConfidenceSchema = z.enum(['high', 'medium', 'low']);

// ── Create COGS Entry ─────────────────────────────────────────────────────────

export const createCogsEntrySchema = z.object({
  period_date: z.string().date(), // YYYY-MM-DD
  user_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  epic_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),

  hours_worked: z.number().min(0).default(0),
  hourly_rate: z.number().min(0).default(0),
  overhead_rate: z.number().min(0).max(10).default(1.0),

  category: cogsCategorySchema,
  subcategory: z.string().max(100).optional(),
  source: cogsSourceSchema,
  confidence: cogsConfidenceSchema.default('medium'),

  notes: z.string().max(1000).optional(),
  approved_by: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional()
});

export type CreateCogsEntryInput = z.infer<typeof createCogsEntrySchema>;

// ── List Entries (with filters) ───────────────────────────────────────────────

export const listCogsEntriesQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  epic_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  category: cogsCategorySchema.optional(),
  source: cogsSourceSchema.optional(),
  date_from: z.string().date().optional(), // YYYY-MM-DD
  date_to: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional()
});

export type ListCogsEntriesQuery = z.infer<typeof listCogsEntriesQuerySchema>;

// ── Rollup query ──────────────────────────────────────────────────────────────

export const cogsRollupQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  epic_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  date_from: z.string().date().optional(),
  date_to: z.string().date().optional(),
  group_by: z.enum(['category', 'user', 'project', 'epic', 'team']).default('category')
});

export type CogsRollupQuery = z.infer<typeof cogsRollupQuerySchema>;

// ── Budget ────────────────────────────────────────────────────────────────────

export const createCogsBudgetSchema = z.object({
  project_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
  period: z.string().regex(/^\d{4}-(Q[1-4]|\d{2})$/, 'period must be YYYY-Qn or YYYY-MM'),
  budget_amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  notes: z.string().max(500).optional()
});

export type CreateCogsBudgetInput = z.infer<typeof createCogsBudgetSchema>;

// ── Burn Rate query ───────────────────────────────────────────────────────────

export const burnRateQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
  period: z.string().regex(/^\d{4}-(Q[1-4]|\d{2})$/)
});

export type BurnRateQuery = z.infer<typeof burnRateQuerySchema>;

// ── Estimate from SP ──────────────────────────────────────────────────────────

export const estimateFromSpSchema = z.object({
  project_id: z.string().uuid().optional(),
  epic_id: z.string().uuid().optional(),
  story_points: z.number().int().positive(),
  user_id: z.string().uuid(),
  period_date: z.string().date(),
  category: cogsCategorySchema.default('engineering'),
  notes: z.string().max(500).optional()
});

export type EstimateFromSpInput = z.infer<typeof estimateFromSpSchema>;

// ── Initiative generation ─────────────────────────────────────────────────────

export const initiativeParamsSchema = z.object({
  project_id: z.string().uuid()
});

export const initiativeGenerateBodySchema = z.object({
  overhead_rate: z.number().min(1).max(10).default(1.3)
});

export type InitiativeGenerateBody = z.infer<typeof initiativeGenerateBodySchema>;

// ── List entries (superseded audit filter) ────────────────────────────────────

export const listCogsEntriesAuditQuerySchema = listCogsEntriesQuerySchema.extend({
  superseded: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined))
});
