import { z } from 'zod';

// ── Platform Admin Schemas ───────────────────────────────────────────────────

export const createPlanSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  display_name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  price_cents: z.number().int().min(0),
  currency: z.string().length(3).default('USD'),
  billing_period: z.enum(['monthly', 'annual']),
  stripe_price_id: z.string().optional(),
  modules: z.array(z.string()).min(1),
  max_seats: z.number().int().positive().nullable(),
  max_integrations: z.number().int().positive().nullable(),
  history_days: z.number().int().positive().nullable(),
  trial_days: z.number().int().min(0).default(0),
  features: z.record(z.boolean()).default({}),
  is_public: z.boolean().default(true),
  is_active: z.boolean().default(true)
});

export const updatePlanSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  price_cents: z.number().int().min(0).optional(),
  stripe_price_id: z.string().optional(),
  modules: z.array(z.string()).min(1).optional(),
  max_seats: z.number().int().positive().nullable().optional(),
  max_integrations: z.number().int().positive().nullable().optional(),
  history_days: z.number().int().positive().nullable().optional(),
  trial_days: z.number().int().min(0).optional(),
  features: z.record(z.boolean()).optional(),
  is_public: z.boolean().optional(),
  is_active: z.boolean().optional(),
  apply_at_renewal: z.boolean().default(false)
});

export const listPlansQuerySchema = z.object({
  is_active: z.enum(['true', 'false']).optional(),
  is_public: z.enum(['true', 'false']).optional(),
  is_system: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const createAssignmentSchema = z.object({
  tenant_id: z.string().uuid()
});

// ── Platform Admin — Tenant & Subscription Override Schemas ──────────────────

const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'downgraded', 'cancelled', 'expired'] as const;

export const listTenantsQuerySchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  plan_id: z.string().uuid().optional(),
  search: z.string().min(2).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const listSubscriptionHistoryQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const listPlanTenantsQuerySchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const patchSubscriptionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('extend_grace'),
    extension_days: z.number().int().min(1).max(30),
    reason: z.string().min(1).max(500),
  }),
  z.object({
    action: z.literal('reactivate'),
    reason: z.string().min(1).max(500),
  }),
  z.object({
    action: z.literal('cancel'),
    reason: z.string().min(1).max(500),
  }),
]);

// ── Tenant Schemas ───────────────────────────────────────────────────────────

export const checkoutSchema = z.object({
  plan_id: z.string().uuid(),
  success_url: z.string().url(),
  cancel_url: z.string().url()
});

export const portalSchema = z.object({
  return_url: z.string().url()
});

export const listEventsQuerySchema = z.object({
  event_type: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
