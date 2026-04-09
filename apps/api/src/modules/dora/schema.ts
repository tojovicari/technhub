import { z } from 'zod';

// ── Deploy event ingest ───────────────────────────────────────────────────────

export const ingestDeployEventSchema = z.object({
  project_id: z.string().uuid().optional(),
  source: z.enum(['github_release', 'github_tag', 'manual']).default('manual'),
  external_id: z.string().optional(),
  ref: z.string().min(1),
  commit_sha: z.string().optional(),
  environment: z.string().default('production'),
  deployed_at: z.string().datetime(),
  is_hotfix: z.boolean().optional().default(false),
  is_rollback: z.boolean().optional().default(false),
  pr_ids: z.array(z.string()).optional().default([]),
  raw_payload: z.record(z.unknown()).optional()
});

export type IngestDeployEventInput = z.infer<typeof ingestDeployEventSchema>;

// ── Query schemas ─────────────────────────────────────────────────────────────

export const doraQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  window_days: z.coerce.number().int().min(1).max(365).optional().default(30),
  environment: z.string().optional().default('production')
});

export type DoraQueryInput = z.infer<typeof doraQuerySchema>;

export const listDeployEventsQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  environment: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().uuid().optional()
});

// ── Lead time event (from PR data) ───────────────────────────────────────────

export const ingestLeadTimeEventSchema = z.object({
  project_id: z.string().uuid().optional(),
  pr_id: z.string().min(1),
  first_commit_at: z.string().datetime(),
  merged_at: z.string().datetime(),
  environment: z.string().default('production')
});

export type IngestLeadTimeEventInput = z.infer<typeof ingestLeadTimeEventSchema>;
