import type Stripe from 'stripe';
import { getStripeClient } from './stripe-client';
import { PlanRepository } from './plan.repository';
import type { CreatePlanInput, UpdatePlanInput } from './plan.repository';
import { SubscriptionRepository } from './subscription.repository';
import { SubscriptionHistoryRepository } from './subscription-history.repository';
import { BillingEventRepository } from './billing-event.repository';
import { StripeSubscriptionIndexRepository } from './stripe-subscription-index.repository';
import { BillingError } from './billing-errors';
import type { Plan, Subscription } from './billing.types';

/** `stripePriceId` não entra aqui — sempre calculado internamente (`createPlan`/`updatePlan`), nunca aceito de fora. */
export type CreatePlanServiceInput = Omit<CreatePlanInput, 'stripePriceId'>;
export type UpdatePlanServiceInput = Omit<UpdatePlanInput, 'stripePriceId'>;

export interface CheckoutSessionResult {
  readonly url: string;
  readonly sessionId: string;
}

export interface PortalSessionResult {
  readonly url: string;
}

export interface CancelSubscriptionResult {
  readonly subscription: Subscription;
  readonly accessUntil: Date;
}

/** Extrai as datas do período a partir do primeiro item — Stripe v22+ moveu isso pra fora do objeto Subscription. */
function extractPeriod(subscription: Stripe.Subscription): { readonly start: Date; readonly end: Date } {
  const item = subscription.items.data[0];
  return {
    start: new Date(item.current_period_start * 1000),
    end: new Date(item.current_period_end * 1000),
  };
}

/** Stripe v22+: o id da assinatura de uma invoice mora em `parent.subscription_details.subscription`, não em `invoice.subscription`. */
function extractSubscriptionId(invoice: Stripe.Invoice): string | null {
  const details = invoice.parent?.subscription_details;
  if (!details) return null;

  return typeof details.subscription === 'string' ? details.subscription : (details.subscription?.id ?? null);
}

/**
 * Módulo de Billing/Assinatura — Fase 1 (ver plano de implementação).
 * Orquestra catálogo de planos, assinatura por tenant e o ciclo de vida via
 * Stripe (checkout, portal, cancelamento, webhook).
 */
export class BillingService {
  constructor(
    private readonly planRepository: PlanRepository = new PlanRepository(),
    private readonly subscriptionRepository: SubscriptionRepository = new SubscriptionRepository(),
    private readonly subscriptionHistoryRepository: SubscriptionHistoryRepository = new SubscriptionHistoryRepository(),
    private readonly billingEventRepository: BillingEventRepository = new BillingEventRepository(),
    private readonly stripeIndexRepository: StripeSubscriptionIndexRepository = new StripeSubscriptionIndexRepository(),
  ) {}

  async listPlans(): Promise<readonly Plan[]> {
    return this.planRepository.findPublicActive();
  }

  /** Todos os planos (inclusive privados/inativos) — só o gestor do SaaS vê isso, não o checkout do tenant. */
  async listAllPlans(): Promise<readonly Plan[]> {
    return this.planRepository.findAll();
  }

  /**
   * Cria um plano novo, criando o Price no Stripe automaticamente quando o
   * plano é pago (`priceCents > 0`) — usa `product_data` inline
   * (`stripe.prices.create`) em vez de gerenciar um Product separado: o
   * schema de `plans` só tem `stripe_price_id`, não `stripe_product_id`, e
   * não vale a pena rastrear os dois só pra isso. Plano gratuito nunca cria
   * Price, mesma convenção do seed do plano Free (`stripe_price_id` fica `null`).
   */
  async createPlan(input: CreatePlanServiceInput): Promise<Plan> {
    const stripePriceId =
      input.priceCents > 0 ? await this.createStripePrice(input.displayName, input) : null;

    return this.planRepository.create({ ...input, stripePriceId });
  }

  /**
   * Edita um plano existente. Se algum campo que afeta preço mudar
   * (`priceCents`/`currency`/`billingPeriod`), cria um Price **novo** no
   * Stripe — Price é imutável lá, não dá pra "editar" o valor de um já
   * existente. Assinaturas já ativas no Price antigo continuam nele até
   * upgrade/renovação; o antigo só para de ser oferecido em checkouts novos
   * (não é arquivado/deletado aqui, fora de escopo desta rodada).
   */
  async updatePlan(id: string, patch: UpdatePlanServiceInput): Promise<Plan | null> {
    const priceFieldsChanged =
      patch.priceCents !== undefined || patch.currency !== undefined || patch.billingPeriod !== undefined;

    if (!priceFieldsChanged) {
      return this.planRepository.update(id, patch);
    }

    const current = await this.planRepository.findById(id);
    if (!current) {
      return null;
    }

    const priceCents = patch.priceCents ?? current.priceCents;
    const merged = {
      priceCents,
      currency: patch.currency ?? current.currency,
      billingPeriod: patch.billingPeriod ?? current.billingPeriod,
    };

    const stripePriceId =
      priceCents > 0 ? await this.createStripePrice(patch.displayName ?? current.displayName, merged) : null;

    return this.planRepository.update(id, { ...patch, stripePriceId });
  }

  private async createStripePrice(
    displayName: string,
    priced: { readonly priceCents: number; readonly currency: string; readonly billingPeriod: string },
  ): Promise<string> {
    const stripe = getStripeClient();
    const price = await stripe.prices.create({
      unit_amount: priced.priceCents,
      currency: priced.currency,
      recurring: { interval: priced.billingPeriod === 'annual' ? 'year' : 'month' },
      product_data: { name: displayName },
    });

    return price.id;
  }

  async getSubscription(tenantId: string): Promise<Subscription | null> {
    return this.subscriptionRepository.findByTenantId(tenantId);
  }

  /**
   * Provisionamento automático — chamado pelo `POST /tenants` assim que o
   * tenant é criado. Lança se o plano Free não existir (dependência rígida
   * de propósito, mesmo espírito do sistema antigo).
   */
  async provisionFreeSubscription(tenantId: string): Promise<Subscription> {
    const freePlan = await this.planRepository.findByName('free');
    if (!freePlan) {
      throw new Error('[billing] Plano "free" não encontrado — migration de seed não rodou?');
    }

    const subscription = await this.subscriptionRepository.create(tenantId, {
      planId: freePlan.id,
      status: 'active',
    });

    await this.subscriptionHistoryRepository.create(tenantId, {
      subscriptionId: subscription.id,
      planId: freePlan.id,
      status: subscription.status,
      reason: 'tenant_created',
    });

    return subscription;
  }

  async createCheckoutSession(
    tenantId: string,
    planId: string,
    requesterEmail: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<CheckoutSessionResult> {
    const plan = await this.planRepository.findById(planId);
    if (!plan) {
      throw new BillingError('Plano não encontrado.', 'NOT_FOUND');
    }
    if (!plan.stripePriceId) {
      throw new BillingError('Este plano não tem um preço configurado no Stripe ainda.', 'VALIDATION_ERROR');
    }

    const existingSubscription = await this.subscriptionRepository.findByTenantId(tenantId);
    const stripe = getStripeClient();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: tenantId,
      metadata: { tenantId, planId },
      customer: existingSubscription?.providerCustomerId ?? undefined,
      customer_email: existingSubscription?.providerCustomerId ? undefined : requesterEmail,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      subscription_data: plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : undefined,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    if (!session.url) {
      throw new Error('[billing] Stripe não devolveu uma URL de checkout.');
    }

    return { url: session.url, sessionId: session.id };
  }

  async createPortalSession(tenantId: string, returnUrl: string): Promise<PortalSessionResult> {
    const subscription = await this.subscriptionRepository.findByTenantId(tenantId);
    if (!subscription?.providerCustomerId) {
      throw new BillingError(
        'Este tenant ainda não tem uma sessão de checkout concluída — não há cliente no Stripe pra abrir o portal.',
        'PRECONDITION_FAILED',
      );
    }

    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.providerCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  /**
   * Cancelamento agendado (`cancel_at_period_end`), não imediato —
   * `status: 'cancelled'` já reflete localmente, mas o acesso continua até
   * `currentPeriodEnd`. Não confundir "cancelamento pedido" com "acesso
   * revogado" (mesma semântica sutil do sistema antigo, preservada de
   * propósito).
   */
  async cancelSubscription(tenantId: string): Promise<CancelSubscriptionResult> {
    const subscription = await this.subscriptionRepository.findByTenantId(tenantId);
    if (!subscription) {
      throw new BillingError('Assinatura não encontrada.', 'NOT_FOUND');
    }

    if (subscription.provider === 'stripe' && subscription.providerSubscriptionId) {
      const stripe = getStripeClient();
      await stripe.subscriptions.update(subscription.providerSubscriptionId, { cancel_at_period_end: true });
    }

    const updated = await this.subscriptionRepository.update(tenantId, {
      status: 'cancelled',
      cancelledAt: new Date(),
    });
    if (!updated) {
      throw new BillingError('Assinatura não encontrada.', 'NOT_FOUND');
    }

    await this.subscriptionHistoryRepository.create(tenantId, {
      subscriptionId: updated.id,
      planId: updated.planId,
      status: updated.status,
      reason: 'cancellation_requested',
    });
    await this.billingEventRepository.create(tenantId, { eventType: 'subscription.cancelled' });

    return { subscription: updated, accessUntil: updated.currentPeriodEnd };
  }

  /**
   * Dispatch dos eventos de webhook do Stripe. Nunca lança pra fora — erros
   * de negócio são responsabilidade de quem chama decidir como logar (a
   * rota devolve `200` mesmo assim, pra não gerar retry storm do Stripe).
   */
  private async alreadyProcessed(tenantId: string, eventId: string): Promise<boolean> {
    return this.billingEventRepository.existsByProviderEventId(tenantId, eventId);
  }

  async handleStripeEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event, event.data.object);
        break;
      case 'invoice.paid':
        await this.onInvoicePaid(event, event.data.object);
        break;
      case 'invoice.payment_failed':
        await this.onInvoicePaymentFailed(event, event.data.object);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event, event.data.object);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event, event.data.object);
        break;
      default:
        // Outros tipos de evento são ignorados de propósito nesta fase.
        break;
    }
  }

  private async onCheckoutCompleted(event: Stripe.Event, session: Stripe.Checkout.Session): Promise<void> {
    if (session.mode !== 'subscription') return;

    const tenantId = session.client_reference_id ?? (session.metadata?.tenantId as string | undefined);
    const planId = session.metadata?.planId;
    if (!tenantId || !planId || typeof session.subscription !== 'string') return;

    if (await this.alreadyProcessed(tenantId, event.id)) return;

    const stripe = getStripeClient();
    const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription, {
      expand: ['items'],
    });
    const period = extractPeriod(stripeSubscription);

    await this.stripeIndexRepository.upsert(stripeSubscription.id, tenantId);

    const updated = await this.subscriptionRepository.update(tenantId, {
      planId,
      status: stripeSubscription.status === 'trialing' ? 'trialing' : 'active',
      provider: 'stripe',
      providerCustomerId:
        typeof stripeSubscription.customer === 'string' ? stripeSubscription.customer : stripeSubscription.customer.id,
      providerSubscriptionId: stripeSubscription.id,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      trialEndsAt: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
      pastDueSince: null,
      cancelledAt: null,
    });
    if (!updated) return;

    await this.subscriptionHistoryRepository.create(tenantId, {
      subscriptionId: updated.id,
      planId: updated.planId,
      status: updated.status,
      reason: 'checkout_completed',
    });
    await this.billingEventRepository.create(tenantId, {
      eventType: 'checkout.session.completed',
      provider: 'stripe',
      providerEventId: event.id,
      rawPayload: session,
    });
  }

  private async onInvoicePaid(event: Stripe.Event, invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = extractSubscriptionId(invoice);
    const tenantId = subscriptionId ? await this.stripeIndexRepository.findTenantId(subscriptionId) : null;
    if (!tenantId) return;
    if (await this.alreadyProcessed(tenantId, event.id)) return;

    const updated = await this.subscriptionRepository.update(tenantId, { status: 'active', pastDueSince: null });
    if (!updated) return;

    await this.billingEventRepository.create(tenantId, {
      eventType: 'invoice.paid',
      provider: 'stripe',
      providerEventId: event.id,
    });
  }

  private async onInvoicePaymentFailed(event: Stripe.Event, invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = extractSubscriptionId(invoice);
    const tenantId = subscriptionId ? await this.stripeIndexRepository.findTenantId(subscriptionId) : null;
    if (!tenantId) return;
    if (await this.alreadyProcessed(tenantId, event.id)) return;

    const current = await this.subscriptionRepository.findByTenantId(tenantId);
    if (!current) return;

    // Só seta na primeira falha — não reseta o relógio de graça numa falha repetida.
    await this.subscriptionRepository.update(tenantId, {
      status: 'past_due',
      pastDueSince: current.pastDueSince ?? new Date(),
    });

    await this.billingEventRepository.create(tenantId, {
      eventType: 'invoice.payment_failed',
      provider: 'stripe',
      providerEventId: event.id,
    });
  }

  private async onSubscriptionUpdated(event: Stripe.Event, stripeSubscription: Stripe.Subscription): Promise<void> {
    const tenantId = await this.stripeIndexRepository.findTenantId(stripeSubscription.id);
    if (!tenantId) return;
    if (await this.alreadyProcessed(tenantId, event.id)) return;

    const current = await this.subscriptionRepository.findByTenantId(tenantId);
    if (!current) return;

    const period = extractPeriod(stripeSubscription);

    await this.subscriptionRepository.update(tenantId, {
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      ...(stripeSubscription.cancel_at_period_end && !current.cancelledAt ? { cancelledAt: new Date() } : {}),
    });

    await this.billingEventRepository.create(tenantId, {
      eventType: 'customer.subscription.updated',
      provider: 'stripe',
      providerEventId: event.id,
    });
  }

  private async onSubscriptionDeleted(event: Stripe.Event, stripeSubscription: Stripe.Subscription): Promise<void> {
    const tenantId = await this.stripeIndexRepository.findTenantId(stripeSubscription.id);
    if (!tenantId) return;
    if (await this.alreadyProcessed(tenantId, event.id)) return;

    const current = await this.subscriptionRepository.findByTenantId(tenantId);
    if (!current || current.status === 'expired') return;

    const updated = await this.subscriptionRepository.update(tenantId, { status: 'expired' });
    if (!updated) return;

    await this.subscriptionHistoryRepository.create(tenantId, {
      subscriptionId: updated.id,
      planId: updated.planId,
      status: updated.status,
      reason: 'stripe_subscription_deleted',
    });
    await this.billingEventRepository.create(tenantId, {
      eventType: 'customer.subscription.deleted',
      provider: 'stripe',
      providerEventId: event.id,
    });
  }
}
