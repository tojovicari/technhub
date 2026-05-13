import { z } from 'zod';

export const policyContextSchema = z.object({
  subject_id: z.string().min(1),
  tenant_id: z.string().min(1),
  org_id: z.string().optional(),
  team_ids: z.array(z.string()).optional(),
  roles: z.array(z.string()).optional(),
  permission_profile_ids: z.array(z.string()).optional()
});

export const resourceContextSchema = z.object({
  resource_type: z.string().min(1),
  resource_id: z.string().min(1),
  tenant_id: z.string().min(1),
  team_id: z.string().optional(),
  owner_id: z.string().optional(),
  attributes: z.record(z.unknown()).optional()
});

export const policyEvaluationRequestSchema = z.object({
  action: z.string().min(1),
  required_permissions: z.array(z.string().min(1)).min(1),
  any_of: z.boolean().default(true),
  subject: policyContextSchema,
  resource: resourceContextSchema
});

export const listBindingsQuerySchema = z.object({
  module: z
    .enum(['iam', 'integrations', 'core', 'sla', 'metrics', 'cogs', 'dashboard', 'dora', 'intel', 'auth'])
    .optional()
});

export type PolicyEvaluationRequest = z.infer<typeof policyEvaluationRequestSchema>;
export type ListBindingsQuery = z.infer<typeof listBindingsQuerySchema>;
