/**
 * Módulo de Billing/Assinatura — Fase 1 (catálogo de planos, assinatura por
 * tenant, ciclo de vida via Stripe). Port do módulo de billing do repo
 * antigo (`technhub`), com RLS desde o início e sem os defeitos conhecidos
 * de lá (ver plano de implementação).
 */

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';

export interface Plan {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly billingPeriod: string;
  readonly stripePriceId: string | null;
  readonly trialDays: number;
  readonly isPublic: boolean;
  readonly isActive: boolean;
  /** `null` = ilimitado. */
  readonly maxUsers: number | null;
  readonly maxTeams: number | null;
  readonly maxIntegrations: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Subscription {
  readonly id: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly status: SubscriptionStatus;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly pastDueSince: Date | null;
  readonly cancelledAt: Date | null;
  readonly provider: string | null;
  readonly providerCustomerId: string | null;
  readonly providerSubscriptionId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Só sobrescreve os campos presentes — mesma semântica de PATCH parcial já usada em Team/TeamMembership. */
export interface UpdateSubscriptionInput {
  readonly planId?: string;
  readonly status?: SubscriptionStatus;
  readonly trialEndsAt?: Date | null;
  readonly currentPeriodStart?: Date;
  readonly currentPeriodEnd?: Date;
  readonly pastDueSince?: Date | null;
  readonly cancelledAt?: Date | null;
  readonly provider?: string;
  readonly providerCustomerId?: string;
  readonly providerSubscriptionId?: string;
}

export interface SubscriptionHistoryEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly planId: string;
  readonly status: string;
  readonly effectiveFrom: Date;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export interface CreateSubscriptionHistoryInput {
  readonly subscriptionId: string;
  readonly planId: string;
  readonly status: string;
  readonly reason?: string;
}

export interface BillingEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly eventType: string;
  readonly provider: string | null;
  readonly providerEventId: string | null;
  readonly rawPayload: unknown;
  readonly occurredAt: Date;
  readonly createdAt: Date;
}

export interface CreateBillingEventInput {
  readonly eventType: string;
  readonly provider?: string;
  readonly providerEventId?: string;
  readonly rawPayload?: unknown;
}
