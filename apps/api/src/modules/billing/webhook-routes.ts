import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { prisma } from '../../lib/prisma.js';
import { getStripe } from './stripe.js';
import { invalidateEntitlementCache } from './entitlement.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extrai period dates do primeiro item da subscription (Stripe v22+) */
function extractPeriod(stripeSub: Stripe.Subscription) {
  const item = stripeSub.items.data[0];
  return {
    periodStart: item ? new Date(item.current_period_start * 1000) : null,
    periodEnd: item ? new Date(item.current_period_end * 1000) : null,
  };
}

/** Extrai o ID da subscription a partir de um Invoice (Stripe v22+) */
function extractSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription;
  if (!sub) return null;
  return typeof sub === 'string' ? sub : sub.id;
}

// ── Stripe Webhook Handler ────────────────────────────────────────────────────

export async function billingWebhookRoutes(app: FastifyInstance) {
  // Override do parser JSON neste scope para preservar o body raw
  // necessário para verificação de assinatura do Stripe
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/webhooks/billing/stripe', async (req, reply) => {
    const rawBody = req.body as Buffer;
    const sig = req.headers['stripe-signature'];

    if (!sig || typeof sig !== 'string') {
      return reply.status(400).send({ error: 'Missing stripe-signature header' });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      app.log.error('STRIPE_WEBHOOK_SECRET is not configured');
      return reply.status(500).send({ error: 'Webhook not configured' });
    }

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err: any) {
      app.log.warn({ err: err.message }, 'Stripe webhook signature verification failed');
      return reply.status(400).send({ error: 'Invalid webhook signature' });
    }

    // Idempotência: registrar e checar se o evento já foi processado
    const alreadyProcessed = await prisma.billingEvent.findUnique({
      where: { providerEventId: event.id }
    });
    if (alreadyProcessed) {
      app.log.info({ eventId: event.id }, 'Stripe event already processed — skipping');
      return reply.status(200).send({ received: true });
    }

    try {
      await handleStripeEvent(event, app);
    } catch (err) {
      // Loga mas retorna 200 para evitar reenvio do Stripe por erros de negócio
      app.log.error({ err, eventId: event.id, type: event.type }, 'Error handling Stripe event');
    }

    return reply.status(200).send({ received: true });
  });
}

// ── Event Dispatcher ──────────────────────────────────────────────────────────

async function handleStripeEvent(event: Stripe.Event, app: FastifyInstance) {
  app.log.info({ eventId: event.id, type: event.type }, 'Processing Stripe event');

  switch (event.type) {
    case 'checkout.session.completed':
      await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session, app);
      break;
    case 'invoice.paid':
      await onInvoicePaid(event.data.object as Stripe.Invoice, app, event.id);
      break;
    case 'invoice.payment_failed':
      await onInvoicePaymentFailed(event.data.object as Stripe.Invoice, app, event.id);
      break;
    case 'customer.subscription.updated':
      await onSubscriptionUpdated(event.data.object as Stripe.Subscription, app, event.id);
      break;
    case 'customer.subscription.deleted':
      await onSubscriptionDeleted(event.data.object as Stripe.Subscription, app, event.id);
      break;
    default:
      app.log.debug({ type: event.type }, 'Unhandled Stripe event type — ignoring');
  }
}

// ── Event Handlers ────────────────────────────────────────────────────────────

async function onCheckoutCompleted(session: Stripe.Checkout.Session, app: FastifyInstance) {
  if (session.mode !== 'subscription') return;

  const tenantId = session.client_reference_id ?? session.metadata?.tenantId;
  if (!tenantId) {
    app.log.warn({ sessionId: session.id }, 'checkout.session.completed missing tenantId');
    return;
  }

  const planId = session.metadata?.planId;
  const providerSubscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;
  const providerCustomerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id;

  if (!providerSubscriptionId || !providerCustomerId) {
    app.log.warn({ sessionId: session.id }, 'checkout.session.completed missing subscription or customer');
    return;
  }

  // Buscar datas do período no Stripe (v22: period fica no item, não na subscription)
  const stripeSub = await getStripe().subscriptions.retrieve(providerSubscriptionId, {
    expand: ['items']
  });
  const { periodStart, periodEnd } = extractPeriod(stripeSub);
  const trialEnd = stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null;
  const isTrialing = stripeSub.status === 'trialing';

  const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
  if (!subscription) {
    app.log.warn({ tenantId }, 'checkout.session.completed — no local subscription found');
    return;
  }

  const updateData: Record<string, unknown> = {
    providerCustomerId,
    providerSubscriptionId,
    provider: 'stripe',
    status: isTrialing ? 'trialing' : 'active',
    ...(periodStart && { currentPeriodStart: periodStart }),
    ...(periodEnd && { currentPeriodEnd: periodEnd }),
    trialEndsAt: trialEnd,
    pastDueSince: null,
    cancelledAt: null,
  };

  if (planId && planId !== subscription.planId) {
    updateData.planId = planId;
  }

  await prisma.subscription.update({ where: { tenantId }, data: updateData });

  await prisma.subscriptionHistory.create({
    data: {
      subscriptionId: subscription.id,
      planId: (planId ?? subscription.planId) as string,
      status: isTrialing ? 'trialing' : 'active',
      effectiveFrom: periodStart ?? new Date(),
      reason: 'checkout_completed'
    }
  });

  await prisma.billingEvent.create({
    data: {
      tenantId,
      eventType: 'checkout.session.completed',
      provider: 'stripe',
      providerEventId: session.id,
      rawPayload: JSON.parse(JSON.stringify(session)),
      occurredAt: new Date()
    }
  });

  invalidateEntitlementCache(tenantId);
  app.log.info({ tenantId, providerSubscriptionId }, 'Checkout completed — subscription activated');
}

async function onInvoicePaid(invoice: Stripe.Invoice, app: FastifyInstance, eventId: string) {
  // Stripe v22: subscription ID fica em invoice.parent.subscription_details.subscription
  const providerSubscriptionId = extractSubscriptionId(invoice);
  if (!providerSubscriptionId) return;

  const subscription = await prisma.subscription.findFirst({
    where: { providerSubscriptionId }
  });
  if (!subscription) return;

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'active',
      pastDueSince: null,
    }
  });

  await prisma.billingEvent.create({
    data: {
      tenantId: subscription.tenantId,
      eventType: 'invoice.paid',
      provider: 'stripe',
      providerEventId: eventId,
      occurredAt: new Date()
    }
  });

  invalidateEntitlementCache(subscription.tenantId);
  app.log.info({ tenantId: subscription.tenantId }, 'Invoice paid — subscription active');
}

async function onInvoicePaymentFailed(invoice: Stripe.Invoice, app: FastifyInstance, eventId: string) {
  // Stripe v22: subscription ID fica em invoice.parent.subscription_details.subscription
  const providerSubscriptionId = extractSubscriptionId(invoice);
  if (!providerSubscriptionId) return;

  const subscription = await prisma.subscription.findFirst({
    where: { providerSubscriptionId }
  });
  if (!subscription) return;

  // Só marca past_due_since na primeira falha (não sobreescreve se já está em past_due)
  const now = new Date();
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'past_due',
      pastDueSince: subscription.pastDueSince ?? now
    }
  });

  await prisma.billingEvent.create({
    data: {
      tenantId: subscription.tenantId,
      eventType: 'invoice.payment_failed',
      provider: 'stripe',
      providerEventId: eventId,
      occurredAt: now
    }
  });

  invalidateEntitlementCache(subscription.tenantId);
  app.log.warn({ tenantId: subscription.tenantId }, 'Invoice payment failed — subscription past_due');
}

async function onSubscriptionUpdated(stripeSub: Stripe.Subscription, app: FastifyInstance, eventId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: { providerSubscriptionId: stripeSub.id }
  });
  if (!subscription) return;

  // Stripe v22: period dates ficam no SubscriptionItem, não na Subscription
  const { periodStart, periodEnd } = extractPeriod(stripeSub);

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      ...(periodStart && { currentPeriodStart: periodStart }),
      ...(periodEnd && { currentPeriodEnd: periodEnd }),
      // Se Stripe agendou cancelamento, sincronizar
      ...(stripeSub.cancel_at_period_end && !subscription.cancelledAt && {
        cancelledAt: new Date(),
        status: 'cancelled'
      })
    }
  });

  await prisma.billingEvent.create({
    data: {
      tenantId: subscription.tenantId,
      eventType: 'customer.subscription.updated',
      provider: 'stripe',
      providerEventId: eventId,
      occurredAt: new Date()
    }
  });

  invalidateEntitlementCache(subscription.tenantId);
}

async function onSubscriptionDeleted(stripeSub: Stripe.Subscription, app: FastifyInstance, eventId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: { providerSubscriptionId: stripeSub.id }
  });
  if (!subscription) return;

  // Só avança para expired se ainda não foi feito downgrade pelo job interno
  const finalStatuses = ['downgraded', 'expired'];
  if (finalStatuses.includes(subscription.status)) return;

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: 'expired' }
  });

  await prisma.subscriptionHistory.create({
    data: {
      subscriptionId: subscription.id,
      planId: subscription.planId,
      status: 'expired',
      effectiveFrom: new Date(),
      reason: 'stripe_subscription_deleted'
    }
  });

  await prisma.billingEvent.create({
    data: {
      tenantId: subscription.tenantId,
      eventType: 'customer.subscription.deleted',
      provider: 'stripe',
      providerEventId: eventId,
      occurredAt: new Date()
    }
  });

  invalidateEntitlementCache(subscription.tenantId);
  app.log.info({ tenantId: subscription.tenantId }, 'Stripe subscription deleted — marked expired');
}
