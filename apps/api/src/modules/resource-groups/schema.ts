import { z } from 'zod';

export const resourceGroupStatusSchema = z.enum(['planning', 'active', 'on_hold', 'done']);

export const listResourceGroupsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().uuid().optional(),
  status: resourceGroupStatusSchema.optional()
});

export const resourceGroupParamsSchema = z.object({
  group_id: z.string().uuid()
});

export const createResourceGroupBodySchema = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'key must use lowercase letters, numbers, and dashes'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  status: resourceGroupStatusSchema.optional().default('planning'),
  owner_user_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).optional().default([])
});

export const updateResourceGroupBodySchema = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'key must use lowercase letters, numbers, and dashes')
    .optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  status: resourceGroupStatusSchema.optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).optional()
});

export const addResourceGroupResourceBodySchema = z
  .object({
    project_id: z.string().uuid(),
    role: z.enum(['primary', 'supporting', 'shared']).optional().default('shared'),
    weight_mode: z.enum(['auto', 'manual']).optional().default('auto'),
    manual_weight: z.number().min(0).max(1).nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (value.weight_mode === 'manual' && (value.manual_weight == null || Number.isNaN(value.manual_weight))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['manual_weight'],
        message: 'manual_weight is required when weight_mode is manual'
      });
    }
  });

export const addResourceGroupTeamBodySchema = z.object({
  team_id: z.string().uuid(),
  role: z.enum(['owner', 'contributor', 'platform']).optional().default('contributor'),
  allocation_percent: z.number().min(0).max(100).nullable().optional()
});

export const resourceGroupResourceParamsSchema = z.object({
  group_id: z.string().uuid(),
  project_id: z.string().uuid()
});

export const resourceGroupTeamParamsSchema = z.object({
  group_id: z.string().uuid(),
  team_id: z.string().uuid()
});

export type ListResourceGroupsQuery = z.infer<typeof listResourceGroupsQuerySchema>;
export type CreateResourceGroupBody = z.infer<typeof createResourceGroupBodySchema>;
export type UpdateResourceGroupBody = z.infer<typeof updateResourceGroupBodySchema>;
export type AddResourceGroupResourceBody = z.infer<typeof addResourceGroupResourceBodySchema>;
export type AddResourceGroupTeamBody = z.infer<typeof addResourceGroupTeamBodySchema>;
