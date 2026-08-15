import type Stripe from 'stripe';
import { getStripeClient } from './stripe-client';
import { getFrontendUrl } from '../config/frontend-url';
import { PlanRepository } from './plan.repository';
import type { CreatePlanInput, UpdatePlanInput } from './plan.repository';
import { SubscriptionRepository } from './subscription.repository';
import { SubscriptionHistoryRepository } from './subscription-history.repository';
import { BillingEventRepository } from './billing-event.repository';
import { StripeSubscriptionIndexRepository } from './stripe-subscription-index.repository';
import { EnterpriseCheckoutLinkRepository } from './enterprise-checkout-link.repository';
import { AlertRepository } from '../alerts/alert.repository';
import { BillingError } from './billing-errors';
import type { EnterpriseCheckoutLink, Plan, Subscription } from './billing.types';

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

/**
 * Meses de carência entre um tenant cruzar o teto de retenção do plano
 * (`Plan.dataRetentionMonths`) e o expurgo de verdade acontecer
 * (`RetentionPurgeService`) — constante global, igual pra todos os planos
 * (decisão confirmada com o usuário: não é um campo configurável por
 * plano, pra manter simples de explicar: "seu dado some N meses depois do
 * limite do seu plano, sempre").
 */
const DATA_RETENTION_GRACE_MONTHS = 3;

/** Sem lib de datas neste projeto — subtração de meses simples, usando o próprio `Date` (aceita rollover de mês/ano nativamente). */
function subtractMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() - months);
  return result;
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
    private readonly alertRepository: AlertRepository = new AlertRepository(),
    private readonly enterpriseCheckoutLinkRepository: EnterpriseCheckoutLinkRepository = new EnterpriseCheckoutLinkRepository(),
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
   * Resolve o plano vigente do tenant — mesma lógica reaproveitada por
   * `getResourceLimit` (3 tetos de recurso) e pelos métodos de retenção de
   * dado abaixo. `null` = sem subscription, ou plano não encontrado.
   *
   * Assinatura `expired` (terminal, sem Stripe subscription viva por trás)
   * resolve contra o Free até alguém mover o plano de verdade — sem isso,
   * um tenant expirado continuaria com o plano pago antigo indefinidamente.
   * `past_due`/`cancelled` continuam resolvendo pelo plano atual de
   * propósito: acesso ainda vale durante a graça de pagamento / até
   * `currentPeriodEnd`.
   */
  private async resolvePlan(tenantId: string): Promise<Plan | null> {
    const subscription = await this.subscriptionRepository.findByTenantId(tenantId);
    if (!subscription) return null;

    if (subscription.status === 'expired') {
      return this.planRepository.findByName('free');
    }

    return this.planRepository.findById(subscription.planId);
  }

  /**
   * Resolve o teto de recursos do plano vigente do tenant. `null` = sem
   * limite — tanto quando o próprio plano deixa o campo em branco quanto
   * quando não há subscription/plano resolvível (fail-open de propósito: um
   * tenant com billing malconfigurado não deveria travar criação de
   * usuário/time/integração por um bug de resolução, só por uma decisão de
   * limite de verdade).
   */
  async getResourceLimit(
    tenantId: string,
    resource: 'maxUsers' | 'maxTeams' | 'maxIntegrations',
  ): Promise<number | null> {
    const plan = await this.resolvePlan(tenantId);
    if (!plan) return null;

    return plan[resource];
  }

  /**
   * Corte de data pra expurgo de verdade (`RetentionPurgeService`):
   * `agora - (dataRetentionMonths + DATA_RETENTION_GRACE_MONTHS)`. `null` =
   * retenção ilimitada — plano sem teto configurado, ou sem plano
   * resolvível (fail-open, mesmo espírito de `getResourceLimit`: billing
   * malconfigurado não deveria apagar dado de ninguém por engano).
   */
  async getDataRetentionPurgeCutoff(tenantId: string): Promise<Date | null> {
    const plan = await this.resolvePlan(tenantId);
    if (!plan || plan.dataRetentionMonths === null) return null;

    return subtractMonths(new Date(), plan.dataRetentionMonths + DATA_RETENTION_GRACE_MONTHS);
  }

  /**
   * Corte "cruzou a retenção do plano, mas ainda não expurgou" — usado só
   * pro alerta de aproximação (`alertRepository.evaluateRetentionPurgeApproachingAlert`),
   * nunca pro expurgo em si. `null` = retenção ilimitada, mesmo racional de
   * `getDataRetentionPurgeCutoff`.
   */
  async getDataRetentionWarningCutoff(tenantId: string): Promise<Date | null> {
    const plan = await this.resolvePlan(tenantId);
    if (!plan || plan.dataRetentionMonths === null) return null;

    return subtractMonths(new Date(), plan.dataRetentionMonths);
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

  /**
   * Gera um link de checkout pra um plano enterprise/privado, disparado
   * pelo gestor do SaaS (não pelo próprio tenant) — mesmo mecanismo de
   * `createCheckoutSession` (Stripe Checkout Session normal, sem fluxo
   * nenhum fora do Stripe), só que com `customer_email` pré-preenchido com
   * o contato informado e persistindo o rastreamento em
   * `enterprise_checkout_links` pra medir conversão depois. TTL da sessão
   * é o default do Stripe (24h a partir da criação) — não configurável além
   * disso na API.
   */
  async createEnterpriseCheckoutLink(
    tenantId: string,
    planId: string,
    contactEmail: string,
    operatorEmail: string,
  ): Promise<EnterpriseCheckoutLink> {
    const plan = await this.planRepository.findById(planId);
    if (!plan) {
      throw new BillingError('Plano não encontrado.', 'NOT_FOUND');
    }
    if (!plan.stripePriceId) {
      throw new BillingError('Este plano não tem um preço configurado no Stripe ainda.', 'VALIDATION_ERROR');
    }

    const stripe = getStripeClient();
    const frontendUrl = getFrontendUrl();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: tenantId,
      metadata: { tenantId, planId, source: 'enterprise_link' },
      customer_email: contactEmail,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      subscription_data: plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : undefined,
      success_url: `${frontendUrl}/billing/success?tenantId=${tenantId}`,
      cancel_url: `${frontendUrl}/billing/canceled?tenantId=${tenantId}`,
    });

    if (!session.url || !session.expires_at) {
      throw new Error('[billing] Stripe não devolveu uma URL de checkout.');
    }

    return this.enterpriseCheckoutLinkRepository.create(tenantId, {
      planId,
      contactEmail,
      stripeCheckoutSessionId: session.id,
      checkoutUrl: session.url,
      createdByOperatorEmail: operatorEmail,
      expiresAt: new Date(session.expires_at * 1000),
    });
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
    await this.alertRepository.create(tenantId, {
      type: 'billing_subscription_cancelled',
      severity: 'warning',
      title: 'Assinatura cancelada',
      message: `Sua assinatura foi cancelada. O acesso continua disponível até ${updated.currentPeriodEnd.toISOString()}.`,
      metadata: { planId: updated.planId, accessUntil: updated.currentPeriodEnd },
    });

    return { subscription: updated, accessUntil: updated.currentPeriodEnd };
  }

  /**
   * Move um tenant direto pra um plano sem cobrança (`priceCents: 0`) —
   * único caminho que existe pra isso hoje. `createCheckoutSession`/
   * `createEnterpriseCheckoutLink` exigem `plan.stripePriceId`, que um
   * plano `priceCents: 0` nunca tem (mesma convenção do seed do Free);
   * `cancelSubscription`/o webhook `customer.subscription.deleted` também
   * nunca reatribuem `plan_id` — um tenant cancelado/expirado ficava preso
   * no `plan_id` pago antigo pra sempre, sem nenhuma saída. Sem Stripe
   * Checkout Session de propósito: não tem pagamento nenhum pra proteger
   * aqui, diferente do motivo que exige Checkout Session pros planos pagos.
   *
   * Cancela a assinatura Stripe (se houver) imediatamente, não
   * `cancel_at_period_end` como `cancelSubscription` — o tenant já está de
   * saída do plano pago agora, não faz sentido continuar cobrando até
   * `currentPeriodEnd`.
   */
  async assignFreePlan(tenantId: string, planId: string): Promise<Subscription> {
    const plan = await this.planRepository.findById(planId);
    if (!plan) {
      throw new BillingError('Plano não encontrado.', 'NOT_FOUND');
    }
    if (plan.priceCents !== 0) {
      throw new BillingError(
        'Este endpoint só assume planos sem cobrança (priceCents: 0). Para planos pagos, use checkout ou enterprise-checkout-link.',
        'VALIDATION_ERROR',
      );
    }

    const subscription = await this.subscriptionRepository.findByTenantId(tenantId);
    if (!subscription) {
      throw new BillingError('Assinatura não encontrada.', 'NOT_FOUND');
    }

    if (
      subscription.provider === 'stripe' &&
      subscription.providerSubscriptionId &&
      subscription.status !== 'expired'
    ) {
      const stripe = getStripeClient();
      await stripe.subscriptions.cancel(subscription.providerSubscriptionId);
    }

    const now = new Date();
    const updated = await this.subscriptionRepository.update(tenantId, {
      planId,
      status: 'active',
      cancelledAt: null,
      pastDueSince: null,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    if (!updated) {
      throw new BillingError('Assinatura não encontrada.', 'NOT_FOUND');
    }

    await this.subscriptionHistoryRepository.create(tenantId, {
      subscriptionId: updated.id,
      planId: updated.planId,
      status: updated.status,
      reason: 'moved_to_free_plan',
    });
    await this.billingEventRepository.create(tenantId, { eventType: 'subscription.moved_to_free_plan' });
    await this.alertRepository.create(tenantId, {
      type: 'billing_plan_changed_to_free',
      severity: 'info',
      title: 'Plano alterado',
      message: `Seu plano foi alterado para "${plan.displayName}" (sem cobrança).`,
      metadata: { planId },
    });

    // Nenhum desses alertas ainda faz sentido depois da troca pra um plano
    // sem cobrança — mesmo espírito de `onCheckoutCompleted` resolvendo
    // `billing_subscription_cancelled` numa confirmação nova.
    await this.alertRepository.resolveOpenAlerts(tenantId, 'billing_past_due', null);
    await this.alertRepository.resolveOpenAlerts(tenantId, 'billing_subscription_cancelled', null);
    await this.alertRepository.resolveOpenAlerts(tenantId, 'billing_subscription_expired', null);

    return updated;
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
      case 'checkout.session.expired':
        await this.onCheckoutExpired(event, event.data.object);
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

    // No-op (0 linhas) se esta sessão não veio de um link enterprise —
    // não precisa de `if` aqui, ver docstring de `markPaid`.
    await this.enterpriseCheckoutLinkRepository.markPaid(tenantId, session.id);

    const plan = await this.planRepository.findById(planId);
    await this.alertRepository.create(tenantId, {
      type: 'billing_subscription_confirmed',
      severity: 'info',
      title: 'Assinatura confirmada',
      message: `Sua assinatura foi confirmada no plano "${plan?.displayName ?? updated.planId}".`,
      metadata: { planId: updated.planId },
    });
    // Uma confirmação nova supera qualquer aviso de cancelamento em aberto
    // — mesmo espírito de `onInvoicePaid` resolvendo `billing_past_due`.
    await this.alertRepository.resolveOpenAlerts(tenantId, 'billing_subscription_cancelled', null);

    await this.billingEventRepository.create(tenantId, {
      eventType: 'checkout.session.completed',
      provider: 'stripe',
      providerEventId: event.id,
      rawPayload: session,
    });
  }

  /**
   * Só relevante pra link enterprise (`markExpired` no-opa pra qualquer
   * outra sessão, mesmo espírito de `markPaid` acima) — checkout
   * self-service normal não tem por que reagir a esse evento, já que o
   * front descarta a sessão assim que o usuário sai da página.
   */
  private async onCheckoutExpired(event: Stripe.Event, session: Stripe.Checkout.Session): Promise<void> {
    if (session.mode !== 'subscription') return;

    const tenantId = session.client_reference_id ?? (session.metadata?.tenantId as string | undefined);
    if (!tenantId) return;
    if (await this.alreadyProcessed(tenantId, event.id)) return;

    await this.enterpriseCheckoutLinkRepository.markExpired(tenantId, session.id);

    await this.billingEventRepository.create(tenantId, {
      eventType: 'checkout.session.expired',
      provider: 'stripe',
      providerEventId: event.id,
    });
  }

  private async onInvoicePaid(event: Stripe.Event, invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = extractSubscriptionId(invoice);
    const tenantId = subscriptionId ? await this.stripeIndexRepository.findTenantId(subscriptionId) : null;
    if (!tenantId) return;
    if (await this.alreadyProcessed(tenantId, event.id)) return;

    const current = await this.subscriptionRepository.findByTenantId(tenantId);
    const wasPastDue = current?.status === 'past_due';

    const updated = await this.subscriptionRepository.update(tenantId, { status: 'active', pastDueSince: null });
    if (!updated) return;

    // Só grava histórico na recuperação de uma inadimplência de verdade — uma
    // renovação normal (status já 'active') dispara `invoice.paid` todo mês e
    // não deveria virar uma linha nova em `subscription_history` a cada vez.
    if (wasPastDue) {
      await this.subscriptionHistoryRepository.create(tenantId, {
        subscriptionId: updated.id,
        planId: updated.planId,
        status: updated.status,
        reason: 'payment_recovered',
      });
      await this.alertRepository.resolveOpenAlerts(tenantId, 'billing_past_due', null);
    }

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

    const isFirstFailure = current.pastDueSince === null;

    // Só seta na primeira falha — não reseta o relógio de graça numa falha repetida.
    const updated = await this.subscriptionRepository.update(tenantId, {
      status: 'past_due',
      pastDueSince: current.pastDueSince ?? new Date(),
    });

    // Mesma lógica do `wasPastDue` acima, espelhada: só grava histórico na
    // transição de verdade pra past_due, não em toda falha repetida do
    // mesmo ciclo de cobrança.
    if (isFirstFailure && updated) {
      await this.subscriptionHistoryRepository.create(tenantId, {
        subscriptionId: updated.id,
        planId: updated.planId,
        status: updated.status,
        reason: 'payment_failed',
      });
      await this.alertRepository.create(tenantId, {
        type: 'billing_past_due',
        severity: 'critical',
        title: 'Pagamento falhou',
        message: 'O pagamento da assinatura falhou. Regularize a cobrança para evitar suspensão do acesso.',
        metadata: { planId: updated.planId, pastDueSince: updated.pastDueSince },
      });
    }

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

    // `!current.cancelledAt` cobre só o caminho "de surpresa": um
    // cancelamento feito pelo nosso app (`cancelSubscription`) já seta
    // `cancelledAt` de forma síncrona antes desse webhook chegar, então o
    // alerta abaixo nunca duplica pra um cancelamento que já passou por lá.
    const cancelledJustNow = stripeSubscription.cancel_at_period_end && !current.cancelledAt;

    const updated = await this.subscriptionRepository.update(tenantId, {
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      ...(cancelledJustNow ? { cancelledAt: new Date() } : {}),
    });

    if (cancelledJustNow && updated) {
      await this.alertRepository.create(tenantId, {
        type: 'billing_subscription_cancelled',
        severity: 'warning',
        title: 'Assinatura cancelada',
        message: `Sua assinatura foi cancelada. O acesso continua disponível até ${updated.currentPeriodEnd.toISOString()}.`,
        metadata: { planId: updated.planId, accessUntil: updated.currentPeriodEnd },
      });
    }

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
    await this.alertRepository.create(tenantId, {
      type: 'billing_subscription_expired',
      severity: 'critical',
      title: 'Assinatura cancelada/expirada',
      message: 'A assinatura foi cancelada ou expirada. Acesse o billing para reativar.',
      metadata: { planId: updated.planId, reason: 'stripe_subscription_deleted' },
    });
    await this.billingEventRepository.create(tenantId, {
      eventType: 'customer.subscription.deleted',
      provider: 'stripe',
      providerEventId: event.id,
    });
  }
}
