import { z } from 'zod';

export const createPermissionProfileSchema = z.object({
  tenant_id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  permission_keys: z.array(z.string().min(1)).min(1),
  is_active: z.boolean().default(true)
});

export const updatePermissionProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  permission_keys: z.array(z.string().min(1)).min(1).optional(),
  is_active: z.boolean().optional()
});

export const assignPermissionProfileSchema = z.object({
  tenant_id: z.string().min(1),
  permission_profile_id: z.string().min(1),
  expires_at: z.string().datetime().optional()
});

export const listProfilesQuerySchema = z.object({
  is_active: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  is_system: z.enum(['true', 'false']).transform(v => v === 'true').optional()
});

export type CreatePermissionProfileInput = z.infer<typeof createPermissionProfileSchema>;
export type UpdatePermissionProfileInput = z.infer<typeof updatePermissionProfileSchema>;
export type AssignPermissionProfileInput = z.infer<typeof assignPermissionProfileSchema>;
export type ListProfilesQueryInput = z.infer<typeof listProfilesQuerySchema>;
