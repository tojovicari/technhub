import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit');

export const registerSchema = z.object({
  tenant_id: z.string().min(1),
  email: z.string().email(),
  password: passwordSchema,
  full_name: z.string().min(1)
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(1)
});

export const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['org_admin', 'manager', 'viewer']).default('viewer')
});

export const registerByInviteSchema = z.object({
  invite_token: z.string().min(1),
  password: passwordSchema,
  full_name: z.string().min(1)
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type RegisterByInviteInput = z.infer<typeof registerByInviteSchema>;
