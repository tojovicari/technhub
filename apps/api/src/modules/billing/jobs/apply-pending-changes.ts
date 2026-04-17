import type { Logger } from 'pino';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { invalidateEntitlementCache } from '../entitlement.js';

/**
 * Job: Apply Pending Plan Changes
 * 
 * Frequência: A cada 6 horas
 * 
 * Objetivo:
 * - Buscar subscriptions com pendingPlanChanges não-nulo
 * - Verificar se o período atual já passou (currentPeriodEnd < now)
 * - Para cada subscription:
 *   - Criar um novo Plan exclusivo com as mudanças
 *   - Atualizar subscription para apontar para o novo Plan
 *   - Limpar pendingPlanChanges
 *   - Invalidar cache de entitlement
 *   - Criar BillingEvent e SubscriptionHistory
 */
export async function applyPendingChanges(logger: Logger) {
  logger.info('Starting apply-pending-changes job');

  const now = new Date();

  // Buscar subscriptions com mudanças pendentes e período expirado
  const subscriptions = await prisma.subscription.findMany({
    where: {
      pendingPlanChanges: { not: Prisma.JsonNull },
      currentPeriodEnd: { lte: now }
    },
    include: {
      plan: true
    }
  });

  if (subscriptions.length === 0) {
    logger.info('No pending changes to apply');
    return;
  }

  logger.info({ count: subscriptions.length }, 'Found subscriptions with pending changes');

  for (const subscription of subscriptions) {
    try {
      const changes = subscription.pendingPlanChanges as any;
      const basePlan = subscription.plan;
      if (!basePlan) {
        logger.warn({ subscriptionId: subscription.id }, 'Subscription missing plan, skipping');
        continue;
      }
      const tenantId = subscription.tenantId;

      // Criar novo plano exclusivo com as mudanças aplicadas
      const newPlan = await prisma.plan.create({
        data: {
          name: `${basePlan.name}_custom_${tenantId.slice(0, 8)}`,
          displayName: basePlan.displayName,
          description: `Custom plan for tenant ${tenantId}`,
          priceCents: changes.priceCents ?? basePlan.priceCents,
          currency: basePlan.currency,
          billingPeriod: basePlan.billingPeriod,
          stripePriceId: basePlan.stripePriceId,
          modules: changes.modules ?? basePlan.modules,
          maxSeats: changes.maxSeats !== undefined ? changes.maxSeats : basePlan.maxSeats,
          maxIntegrations: changes.maxIntegrations !== undefined ? changes.maxIntegrations : basePlan.maxIntegrations,
          historyDays: changes.historyDays !== undefined ? changes.historyDays : basePlan.historyDays,
          trialDays: 0, // Sem trial em planos customizados
          features: changes.features ?? basePlan.features,
          isSystem: false,
          isPublic: false, // Planos customizados são privados
          isActive: true
        }
      });

      // Criar assignment para tornar o plano visível apenas para este tenant
      await prisma.planTenantAssignment.create({
        data: {
          planId: newPlan.id,
          tenantId
        }
      });

      // Atualizar subscription
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          planId: newPlan.id,
          pendingPlanChanges: Prisma.JsonNull
        }
      });

      // Criar SubscriptionHistory
      await prisma.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          planId: newPlan.id,
          status: subscription.status,
          effectiveFrom: now,
          reason: 'pending_changes_applied'
        }
      });

      // Criar BillingEvent
      await prisma.billingEvent.create({
        data: {
          tenantId,
          eventType: 'pending_changes_applied',
          provider: subscription.provider,
          occurredAt: now
        }
      });

      // Invalidar cache
      invalidateEntitlementCache(tenantId);

      logger.info(
        { tenantId, subscriptionId: subscription.id, newPlanId: newPlan.id },
        'Applied pending changes successfully'
      );
    } catch (error) {
      logger.error(
        { error, subscriptionId: subscription.id, tenantId: subscription.tenantId },
        'Failed to apply pending changes'
      );
    }
  }

  logger.info({ processed: subscriptions.length }, 'Completed apply-pending-changes job');
}
