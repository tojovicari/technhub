import type { Logger } from 'pino';
import { prisma } from '../../../lib/prisma.js';
import { invalidateEntitlementCache } from '../entitlement.js';

/**
 * Job: Purge Tenant Data
 * 
 * Frequência: Diariamente às 3am (via cron-like scheduling)
 * 
 * Objetivo:
 * - Buscar subscriptions com status 'downgraded'
 * - Verificar se dataDeletionScheduledAt <= now
 * - Expurgar dados não-core do tenant:
 *   - SLA: templates, compliance snapshots
 *   - COGS: entries, budgets
 *   - DORA: deploys, lead time records
 *   - Intel: analysis cache, recommendations
 *   - Integrations: connections, webhooks, sync state
 * - Atualizar status para 'expired'
 * - Se falhar, adicionar à PurgeFailureQueue com retry exponencial
 */
export async function purgeTenantData(logger: Logger) {
  logger.info('Starting purge-tenant-data job');

  const now = new Date();

  // Buscar subscriptions para expurgar
  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: 'downgraded',
      dataDeletionScheduledAt: { lte: now }
    },
    include: {
      plan: true
    }
  });

  if (subscriptions.length === 0) {
    logger.info('No tenants to purge');
    return;
  }

  logger.info({ count: subscriptions.length }, 'Found tenants to purge');

  for (const subscription of subscriptions) {
    const tenantId = subscription.tenantId;

    try {
      await purgeNonCoreData(tenantId, logger);

      // Atualizar subscription para expired
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'expired'
        }
      });

      // Criar SubscriptionHistory
      await prisma.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          planId: subscription.planId,
          status: 'expired',
          effectiveFrom: now,
          reason: 'data_deletion_executed'
        }
      });

      // Criar BillingEvent
      await prisma.billingEvent.create({
        data: {
          tenantId,
          eventType: 'data_purged',
          provider: subscription.provider,
          occurredAt: now
        }
      });

      // Invalidar cache
      invalidateEntitlementCache(tenantId);

      logger.info(
        { tenantId, subscriptionId: subscription.id },
        'Successfully purged tenant data'
      );
    } catch (error) {
      logger.error(
        { error, tenantId, subscriptionId: subscription.id },
        'Failed to purge tenant data'
      );

      // Adicionar à DLQ para retry
      await addToPurgeFailureQueue(subscription.id, tenantId, error as Error, logger);
    }
  }

  logger.info({ processed: subscriptions.length }, 'Completed purge-tenant-data job');

  // Processar fila de falhas (retry)
  await retryFailedPurges(logger);
}

/**
 * Expurga dados não-core de um tenant
 */
async function purgeNonCoreData(tenantId: string, logger: Logger) {
  logger.info({ tenantId }, 'Purging non-core data');

  await prisma.$transaction(async (tx) => {
    // SLA: templates
    await tx.slaTemplate.deleteMany({
      where: { tenantId }
    });

    // COGS: entries e budgets
    await tx.cogsEntry.deleteMany({ where: { tenantId } });
    await tx.cogsBudget.deleteMany({ where: { tenantId } });

    // DORA: deploy events
    await tx.deployEvent.deleteMany({ where: { tenantId } });

    // Intel: analysis cache (se houver tabela específica - por enquanto skip)
    // TODO: adicionar se Intel tiver tabelas próprias

    // Integrations: connections e webhook events
    const connections = await tx.integrationConnection.findMany({
      where: { tenantId },
      select: { id: true }
    });
    const connectionIds = connections.map(c => c.id);

    if (connectionIds.length > 0) {
      await tx.integrationWebhookEvent.deleteMany({
        where: { connectionId: { in: connectionIds } }
      });
      await tx.integrationConnection.deleteMany({
        where: { id: { in: connectionIds } }
      });
    }

    // Comms module não tem tabelas específicas ainda
    // TODO: adicionar quando Comms tiver persistência própria

    logger.info({ tenantId }, 'Non-core data purged successfully');
  });
}

/**
 * Adiciona subscription à fila de falhas para retry posterior
 */
async function addToPurgeFailureQueue(
  subscriptionId: string,
  tenantId: string,
  error: Error,
  logger: Logger
) {
  try {
    // Verificar se já existe na fila
    const existing = await prisma.purgeFailureQueue.findFirst({
      where: { subscriptionId }
    });

    if (existing) {
      // Incrementar retryCount
      const nextRetry = calculateNextRetry(existing.retryCount + 1);

      await prisma.purgeFailureQueue.update({
        where: { id: existing.id },
        data: {
          retryCount: { increment: 1 },
          nextRetryAt: nextRetry,
          error: error.message
        }
      });

      logger.info(
        { subscriptionId, retryCount: existing.retryCount + 1, nextRetry },
        'Updated purge failure queue entry'
      );
    } else {
      // Adicionar novo
      const nextRetry = calculateNextRetry(1);

      await prisma.purgeFailureQueue.create({
        data: {
          subscriptionId,
          tenantId,
          retryCount: 1,
          nextRetryAt: nextRetry,
          error: error.message
        }
      });

      logger.info(
        { subscriptionId, nextRetry },
        'Added to purge failure queue'
      );
    }
  } catch (queueError) {
    logger.error(
      { queueError, subscriptionId },
      'Failed to add to purge failure queue'
    );
  }
}

/**
 * Calcula próximo horário de retry com backoff exponencial
 * Retry 1: +1h
 * Retry 2: +2h
 * Retry 3: +4h
 * Retry 4: +8h
 * Retry 5+: +24h
 */
function calculateNextRetry(retryCount: number): Date {
  const now = Date.now();
  
  if (retryCount >= 5) {
    return new Date(now + 24 * 60 * 60 * 1000); // 24h
  }
  
  const hoursDelay = Math.pow(2, retryCount - 1);
  return new Date(now + hoursDelay * 60 * 60 * 1000);
}

/**
 * Processa fila de falhas e retry purges
 */
async function retryFailedPurges(logger: Logger) {
  const now = new Date();

  const pending = await prisma.purgeFailureQueue.findMany({
    where: {
      nextRetryAt: { lte: now },
      retryCount: { lt: 10 } // Máximo de 10 tentativas
    }
  });

  if (pending.length === 0) {
    return;
  }

  logger.info({ count: pending.length }, 'Retrying failed purges');

  for (const entry of pending) {
    const { subscriptionId, tenantId } = entry;

    // Buscar subscription
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId }
    });

    if (!subscription) {
      // Subscription foi deletada manualmente, remover da fila
      await prisma.purgeFailureQueue.delete({ where: { id: entry.id } });
      continue;
    }

    try {
      await purgeNonCoreData(tenantId, logger);

      // Atualizar subscription
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'expired' }
      });

      // Criar SubscriptionHistory
      await prisma.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          planId: subscription.planId,
          status: 'expired',
          effectiveFrom: now,
          reason: 'data_deletion_executed_retry'
        }
      });

      // Criar BillingEvent
      await prisma.billingEvent.create({
        data: {
          tenantId,
          eventType: 'data_purged',
          provider: subscription.provider,
          occurredAt: now
        }
      });

      // Invalidar cache
      invalidateEntitlementCache(tenantId);

      // Remover da fila
      await prisma.purgeFailureQueue.delete({ where: { id: entry.id } });

      logger.info(
        { tenantId, subscriptionId: subscription.id, retryCount: entry.retryCount },
        'Successfully purged tenant data on retry'
      );
    } catch (error) {
      logger.error(
        { error, tenantId, retryCount: entry.retryCount },
        'Failed to purge on retry'
      );

      // Atualizar com próximo retry
      await addToPurgeFailureQueue(subscription.id, tenantId, error as Error, logger);
    }
  }
}
