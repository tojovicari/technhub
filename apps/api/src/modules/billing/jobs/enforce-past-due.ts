import type { Logger } from 'pino';
import { prisma } from '../../../lib/prisma.js';
import { invalidateEntitlementCache } from '../entitlement.js';

/**
 * Job: Enforce Past Due Downgrade
 * 
 * Frequência: A cada hora
 * 
 * Objetivo:
 * - Buscar subscriptions em status 'past_due'
 * - Verificar se pastDueSince é >= 10 dias atrás
 * - Fazer downgrade para o plano Free:
 *   - Atualizar status para 'downgraded'
 *   - Agendar data de deleção (D+30)
 *   - Salvar plano atual em scheduledDowngradePlan (se não for Free)
 *   - Mudar para Free plan
 *   - Invalidar cache
 *   - Criar BillingEvent e SubscriptionHistory
 */
export async function enforcePastDueDowngrade(logger: Logger) {
  logger.info('Starting enforce-past-due job');

  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  // Buscar subscriptions em past_due há mais de 10 dias
  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: 'past_due',
      pastDueSince: { lte: tenDaysAgo }
    },
    include: {
      plan: true
    }
  });

  if (subscriptions.length === 0) {
    logger.info('No subscriptions to downgrade');
    return;
  }

  logger.info({ count: subscriptions.length }, 'Found subscriptions to downgrade');

  // Buscar Free plan
  const freePlan = await prisma.plan.findFirst({
    where: {
      name: 'free',
      isSystem: true,
      isActive: true
    }
  });

  if (!freePlan) {
    logger.error('Free plan not found - cannot proceed with downgrade');
    return;
  }

  for (const subscription of subscriptions) {
    try {
      const tenantId = subscription.tenantId;
      const currentPlan = subscription.plan;

      // Data de deleção: D+30 a partir de agora
      const deletionDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      // Atualizar subscription
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'downgraded',
          planId: freePlan.id,
          downgradedAt: now,
          dataDeletionScheduledAt: deletionDate,
          scheduledDowngradePlanId: currentPlan.name !== 'free' ? currentPlan.id : null
        }
      });

      // Criar SubscriptionHistory
      await prisma.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          planId: freePlan.id,
          status: 'downgraded',
          effectiveFrom: now,
          reason: 'past_due_grace_expired'
        }
      });

      // Criar BillingEvent
      await prisma.billingEvent.create({
        data: {
          tenantId,
          eventType: 'subscription_downgraded',
          provider: subscription.provider,
          occurredAt: now
        }
      });

      // Invalidar cache
      invalidateEntitlementCache(tenantId);

      logger.info(
        {
          tenantId,
          subscriptionId: subscription.id,
          pastDueSince: subscription.pastDueSince,
          deletionScheduled: deletionDate
        },
        'Downgraded subscription due to past_due grace period expiration'
      );
    } catch (error) {
      logger.error(
        { error, subscriptionId: subscription.id, tenantId: subscription.tenantId },
        'Failed to downgrade subscription'
      );
    }
  }

  logger.info({ processed: subscriptions.length }, 'Completed enforce-past-due job');
}
