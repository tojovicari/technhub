// src/modules/billing/entitlement.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { fail } from '../../lib/http.js';

type EntitlementEntry = {
  tenantId: string;
  planName: string;
  modules: string[];
  maxSeats: number | null;
  maxIntegrations: number | null;
  historyDays: number | null;
  features: Record<string, boolean>;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date;
  cachedAt: Date;
};

const cache = new Map<string, EntitlementEntry>();
const TTL_MS = 60_000; // 60 segundos

export async function loadEntitlement(tenantId: string): Promise<EntitlementEntry> {
  const cached = cache.get(tenantId);
  if (cached && Date.now() - cached.cachedAt.getTime() < TTL_MS) {
    return cached;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    include: { plan: true }
  });

  if (!subscription) {
    throw new Error(`No subscription found for tenant ${tenantId}`);
  }

  const entry: EntitlementEntry = {
    tenantId,
    planName: subscription.plan.name,
    modules: subscription.plan.modules,
    maxSeats: subscription.plan.maxSeats,
    maxIntegrations: subscription.plan.maxIntegrations,
    historyDays: subscription.plan.historyDays,
    features: subscription.plan.features as Record<string, boolean>,
    status: subscription.status,
    trialEndsAt: subscription.trialEndsAt,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cachedAt: new Date()
  };

  cache.set(tenantId, entry);
  return entry;
}

export function invalidateEntitlementCache(tenantId: string) {
  cache.delete(tenantId);
}

// Exportar guards para uso nos módulos
export function requireModule(moduleName: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const ent = await loadEntitlement(tenantId);

    // Subscriptions expired bloqueiam módulos premium
    const blockedStatuses = ['expired'];
    if (blockedStatuses.includes(ent.status) || !ent.modules.includes(moduleName)) {
      return reply.status(402).send(
        fail(request, 'UPGRADE_REQUIRED', `Module "${moduleName}" requires a higher plan.`, {
          module_required: moduleName,
          current_plan_modules: ent.modules,
          upgrade_url: 'https://moasy.tech/billing/upgrade'
        })
      );
    }
  };
}

export function requireFeature(featureName: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const ent = await loadEntitlement(tenantId);

    if (!ent.features[featureName]) {
      return reply.status(402).send(
        fail(request, 'UPGRADE_REQUIRED', `Feature "${featureName}" requires a higher plan.`)
      );
    }
  };
}

export { loadEntitlement as getEntitlement };
