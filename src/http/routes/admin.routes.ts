import type { FastifyInstance } from 'fastify';
import { TenantRepository } from '../../identity/tenant.repository';
import { UserRepository } from '../../identity/user.repository';
import { TeamRepository } from '../../identity/team.repository';
import { ProviderIntegrationRepository } from '../../integrations/repositories/provider-integration.repository';
import { IntegrationRunHistoryRepository } from '../../integrations/repositories/integration-run-history.repository';
import { PlanRepository } from '../../billing/plan.repository';
import { SubscriptionRepository } from '../../billing/subscription.repository';
import { SubscriptionHistoryRepository } from '../../billing/subscription-history.repository';
import { BillingService } from '../../billing/billing.service';
import type { CreatePlanServiceInput, UpdatePlanServiceInput } from '../../billing/billing.service';
import { BillingError } from '../../billing/billing-errors';
import { EnterpriseCheckoutLinkRepository } from '../../billing/enterprise-checkout-link.repository';
import { NotificationService } from '../../notifications/notification.service';
import type { Tenant, User } from '../../identity/identity.types';
import type { Subscription, Plan, SubscriptionStatus, EnterpriseCheckoutLink } from '../../billing/billing.types';
import { PlatformOperatorAuditLogRepository } from '../../platform-admin/platform-operator-audit-log.repository';
import { requirePlatformOperator } from '../middleware/require-platform-operator';
import { signImpersonationToken, verifyAuthToken } from '../../auth/core/jwt';
import { getPlatformAdminRoutePrefix } from '../../config/platform-admin-route-prefix';

const BEARER_PREFIX = 'Bearer ';

/** Precisa bater com `IMPERSONATION_TOKEN_TTL` em `auth/core/jwt.ts` — só reportado aqui pro front, o TTL real já está embutido no JWT assinado por `signImpersonationToken`. */
const IMPERSONATION_TOKEN_EXPIRES_IN_SECONDS = 60 * 60;

/** Ordem fixa em `funnel.currentByStatus` — todo status aparece, mesmo com `count: 0`, pro front não ter que inventar os que faltam. */
const ALL_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'cancelled', 'expired'];

interface TenantIdParams {
  readonly tenantId: string;
}
interface PlanIdParams {
  readonly planId: string;
}
interface ImpersonateParams {
  readonly tenantId: string;
  readonly userId: string;
}
interface TenantIntegrationIdParams {
  readonly tenantId: string;
  readonly integrationId: string;
}
interface AuditLogQuery {
  readonly tenantId?: string;
  readonly limit?: string;
}

interface CreatePlanBody {
  readonly name?: string;
  readonly displayName?: string;
  readonly priceCents?: number;
  readonly currency?: string;
  readonly billingPeriod?: string;
  readonly trialDays?: number;
  readonly isPublic?: boolean;
  readonly isActive?: boolean;
  readonly maxUsers?: number | null;
  readonly maxTeams?: number | null;
  readonly maxIntegrations?: number | null;
  readonly dataRetentionMonths?: number | null;
}

interface UpdatePlanBody {
  readonly displayName?: string;
  readonly priceCents?: number;
  readonly currency?: string;
  readonly billingPeriod?: string;
  readonly trialDays?: number;
  readonly isPublic?: boolean;
  readonly isActive?: boolean;
  readonly maxUsers?: number | null;
  readonly maxTeams?: number | null;
  readonly maxIntegrations?: number | null;
  readonly dataRetentionMonths?: number | null;
}

interface CreateEnterpriseCheckoutLinkBody {
  readonly planId?: string;
  readonly contactEmail?: string;
}

interface AssignFreePlanBody {
  readonly planId?: string;
}

const BILLING_ERROR_STATUS: Record<BillingError['code'], number> = {
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  PRECONDITION_FAILED: 422,
};

/**
 * Monta o mesmo formato de tenant+plano+assinatura usado tanto na listagem
 * (`GET {prefix}/tenants`) quanto no detalhe de um só (`GET {prefix}/tenants/:tenantId`)
 * — extraído pra não duplicar a resolução de plano.
 */
function buildTenantOverview(tenant: Tenant, subscription: Subscription | null, planById: Map<string, Plan>) {
  const plan = subscription ? (planById.get(subscription.planId) ?? null) : null;

  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    plan: plan ? { id: plan.id, displayName: plan.displayName } : null,
    subscription: subscription
      ? {
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
          trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
          cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
          providerCustomerId: subscription.providerCustomerId,
        }
      : null,
  };
}

/**
 * Envia o email do link de checkout enterprise de forma best-effort: nunca
 * lança, nunca atrasa a resposta `201` — mesma filosofia de
 * `sendInviteEmailBestEffort` (`users.routes.ts`).
 */
function sendEnterpriseCheckoutLinkEmailBestEffort(
  notificationService: NotificationService,
  tenantRepository: TenantRepository,
  planRepository: PlanRepository,
  link: EnterpriseCheckoutLink,
): void {
  Promise.all([
    tenantRepository.findManyByIds([link.tenantId]).then((tenants) => tenants[0]?.name ?? 'seu workspace'),
    planRepository.findById(link.planId),
  ])
    .then(([tenantName, plan]) =>
      notificationService.sendEnterpriseCheckoutLinkEmail({
        to: link.contactEmail,
        tenantName,
        planDisplayName: plan?.displayName ?? 'novo plano',
        checkoutUrl: link.checkoutUrl,
        expiresAt: link.expiresAt,
        priceCents: plan?.priceCents ?? 0,
        currency: plan?.currency ?? 'usd',
        billingPeriod: plan?.billingPeriod ?? 'monthly',
        trialDays: plan?.trialDays ?? 0,
        maxUsers: plan?.maxUsers ?? null,
        maxTeams: plan?.maxTeams ?? null,
        maxIntegrations: plan?.maxIntegrations ?? null,
      }),
    )
    .then((result) => {
      if (!result.success) {
        console.error(`[admin.routes] Falha ao enviar email de link enterprise para "${link.contactEmail}": ${result.error}`);
      }
    })
    .catch((error) => {
      console.error(`[admin.routes] Erro inesperado ao enviar email de link enterprise: ${(error as Error).message}`);
    });
}

/**
 * Rotas do gestor do SaaS — cross-tenant, fora do namespace `/tenants/:tenantId/*`.
 * Prefixo vem de `PLATFORM_ADMIN_ROUTE_PREFIX` (ver
 * `config/platform-admin-route-prefix.ts`), não-óbvio de propósito. Se não
 * configurado, **as rotas não são registradas** (falha fechada) — sem
 * `PLATFORM_ADMIN_ROUTE_PREFIX`, esse conjunto inteiro simplesmente não
 * existe no servidor, mesma decisão de `auth.routes.ts` pro branch de login.
 *
 * Só `requirePlatformOperator` — nunca `requireSameTenant`/`requireAuth`
 * comum, não se aplica (não há tenant na URL).
 */
export function registerAdminRoutes(
  server: FastifyInstance,
  tenantRepository: TenantRepository = new TenantRepository(),
  planRepository: PlanRepository = new PlanRepository(),
  subscriptionRepository: SubscriptionRepository = new SubscriptionRepository(),
  billingService: BillingService = new BillingService(),
  userRepository: UserRepository = new UserRepository(),
  teamRepository: TeamRepository = new TeamRepository(),
  integrationRepository: ProviderIntegrationRepository = new ProviderIntegrationRepository(),
  auditLogRepository: PlatformOperatorAuditLogRepository = new PlatformOperatorAuditLogRepository(),
  subscriptionHistoryRepository: SubscriptionHistoryRepository = new SubscriptionHistoryRepository(),
  runHistoryRepository: IntegrationRunHistoryRepository = new IntegrationRunHistoryRepository(),
  enterpriseCheckoutLinkRepository: EnterpriseCheckoutLinkRepository = new EnterpriseCheckoutLinkRepository(),
  notificationService: NotificationService = new NotificationService(),
): void {
  const prefix = getPlatformAdminRoutePrefix();
  if (!prefix) {
    return;
  }

  /**
   * Visão cross-tenant: tenant + plano + assinatura numa lista só.
   * `providerCustomerId` linka pro Stripe Dashboard em vez de reimplementar
   * gestão de cartão aqui (fora do escopo de PCI que a Stripe já resolve).
   *
   * `Promise.all` de uma chamada por tenant (`SubscriptionRepository.findByTenantId`,
   * RLS) — mesmo teto de conexões do pool já documentado em
   * `docs/BACKLOG.md`/`sync.orchestrator.ts`; aceitável pra uma tela acionada
   * manualmente por 1 pessoa, não um cron automático.
   */
  server.get(`${prefix}/tenants`, { preHandler: [requirePlatformOperator] }, async (_request, reply) => {
    const [tenants, plans] = await Promise.all([tenantRepository.findAll(), planRepository.findAll()]);
    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    const overview = await Promise.all(
      tenants.map(async (tenant) => {
        const subscription = await subscriptionRepository.findByTenantId(tenant.id);
        return buildTenantOverview(tenant, subscription, planById);
      }),
    );

    return reply.status(200).send(overview);
  });

  /**
   * Detalhe de um tenant só — mesmo formato do item da lista acima. `404`
   * se o `tenantId` não existir (a lista nunca precisou checar isso, já que
   * só itera o que `findAll` já devolveu; aqui é o único ponto que valida
   * existência de verdade).
   */
  server.get<{ Params: TenantIdParams }>(
    `${prefix}/tenants/:tenantId`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const [tenants, plans] = await Promise.all([
        tenantRepository.findManyByIds([request.params.tenantId]),
        planRepository.findAll(),
      ]);
      const tenant = tenants[0];
      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant não encontrado.' });
      }

      const planById = new Map(plans.map((plan) => [plan.id, plan]));
      const subscription = await subscriptionRepository.findByTenantId(tenant.id);

      return reply.status(200).send(buildTenantOverview(tenant, subscription, planById));
    },
  );

  /**
   * Drilldown de leitura — reaproveita os mesmos repositórios já usados
   * pelas rotas tenant-scoped equivalentes (`GET /tenants/:tenantId/users`
   * etc.), só chamados com o `tenantId` da URL em vez de vir do token (não
   * existe "o tenant do token" pro gestor do SaaS). De propósito **não**
   * aceita o token de operador nas rotas tenant-scoped normais — mantém o
   * isolamento entre os dois mecanismos de auth, só cria o espelho de
   * leitura aqui. `tenantId` inexistente devolve lista vazia (RLS não acha
   * nada), mesmo comportamento das rotas tenant-scoped — sem checagem de
   * existência extra, só o `GET .../tenants/:tenantId` acima faz isso.
   */
  server.get<{ Params: TenantIdParams }>(
    `${prefix}/tenants/:tenantId/users`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const users = await userRepository.findAllByTenant(request.params.tenantId);
      return reply.status(200).send(users);
    },
  );

  server.get<{ Params: TenantIdParams }>(
    `${prefix}/tenants/:tenantId/teams`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const teams = await teamRepository.findAllByTenant(request.params.tenantId);
      return reply.status(200).send(teams);
    },
  );

  server.get<{ Params: TenantIdParams }>(
    `${prefix}/tenants/:tenantId/integrations`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const integrations = await integrationRepository.listByTenant(request.params.tenantId);
      return reply.status(200).send(integrations);
    },
  );

  /** Mesmo espelho de leitura do drilldown acima, um nível mais fundo — histórico de execução (sync/enrichment) de uma integração específica. */
  server.get<{ Params: TenantIntegrationIdParams }>(
    `${prefix}/tenants/:tenantId/integrations/:integrationId/run-history`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const { tenantId, integrationId } = request.params;
      const history = await runHistoryRepository.findByIntegration(tenantId, integrationId);
      return reply.status(200).send(history);
    },
  );

  server.post<{ Params: TenantIdParams }>(
    `${prefix}/tenants/:tenantId/suspend`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const tenant = await tenantRepository.updateStatus(request.params.tenantId, 'SUSPENDED');
      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant não encontrado.' });
      }
      await auditLogRepository.record({
        operatorExternalUserId: request.platformOperator!.externalUserId,
        operatorEmail: request.platformOperator!.primaryEmail,
        action: 'SUSPEND_TENANT',
        targetTenantId: tenant.id,
      });
      return reply.status(200).send(tenant);
    },
  );

  server.post<{ Params: TenantIdParams }>(
    `${prefix}/tenants/:tenantId/reactivate`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const tenant = await tenantRepository.updateStatus(request.params.tenantId, 'ACTIVE');
      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant não encontrado.' });
      }
      await auditLogRepository.record({
        operatorExternalUserId: request.platformOperator!.externalUserId,
        operatorEmail: request.platformOperator!.primaryEmail,
        action: 'REACTIVATE_TENANT',
        targetTenantId: tenant.id,
      });
      return reply.status(200).send(tenant);
    },
  );

  /** Reaproveita `BillingService.cancelSubscription`, o mesmo método usado por `POST /tenants/:tenantId/billing/cancel`. */
  server.post<{ Params: TenantIdParams }>(
    `${prefix}/tenants/:tenantId/cancel-subscription`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      try {
        const result = await billingService.cancelSubscription(request.params.tenantId);
        await auditLogRepository.record({
          operatorExternalUserId: request.platformOperator!.externalUserId,
          operatorEmail: request.platformOperator!.primaryEmail,
          action: 'CANCEL_SUBSCRIPTION',
          targetTenantId: request.params.tenantId,
        });
        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof BillingError) {
          return reply.status(BILLING_ERROR_STATUS[error.code]).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  /**
   * Move o tenant direto pra um plano sem cobrança (`priceCents: 0`) — sem
   * Checkout Session, já que não tem pagamento nenhum pra proteger. Único
   * caminho pra sair de um plano pago (ou de uma assinatura `cancelled`/
   * `expired`, que ficavam presas no `plan_id` antigo pra sempre) sem
   * passar pelo Stripe. Ver `BillingService.assignFreePlan`.
   */
  server.post<{ Params: TenantIdParams; Body: AssignFreePlanBody }>(
    `${prefix}/tenants/:tenantId/assign-free-plan`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { planId } = request.body;

      if (!planId) {
        return reply.status(400).send({ error: 'O campo "planId" é obrigatório.' });
      }

      try {
        const subscription = await billingService.assignFreePlan(tenantId, planId);
        await auditLogRepository.record({
          operatorExternalUserId: request.platformOperator!.externalUserId,
          operatorEmail: request.platformOperator!.primaryEmail,
          action: 'ASSIGN_FREE_PLAN',
          targetTenantId: tenantId,
          metadata: { planId },
        });
        return reply.status(200).send(subscription);
      } catch (error) {
        if (error instanceof BillingError) {
          return reply.status(BILLING_ERROR_STATUS[error.code]).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  /** Todos os planos, inclusive privados/inativos — diferente do que o checkout do tenant vê. */
  server.get(`${prefix}/plans`, { preHandler: [requirePlatformOperator] }, async (_request, reply) => {
    const plans = await billingService.listAllPlans();
    return reply.status(200).send(plans);
  });

  server.post<{ Body: CreatePlanBody }>(
    `${prefix}/plans`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const {
        name,
        displayName,
        priceCents,
        currency,
        billingPeriod,
        trialDays,
        isPublic,
        isActive,
        maxUsers,
        maxTeams,
        maxIntegrations,
        dataRetentionMonths,
      } = request.body;

      if (!name || !displayName || priceCents === undefined || !currency || !billingPeriod) {
        return reply.status(400).send({
          error: 'Os campos "name", "displayName", "priceCents", "currency" e "billingPeriod" são obrigatórios.',
        });
      }

      const input: CreatePlanServiceInput = {
        name,
        displayName,
        priceCents,
        currency,
        billingPeriod,
        trialDays: trialDays ?? 0,
        isPublic: isPublic ?? true,
        isActive: isActive ?? true,
        maxUsers: maxUsers ?? null,
        maxTeams: maxTeams ?? null,
        maxIntegrations: maxIntegrations ?? null,
        dataRetentionMonths: dataRetentionMonths ?? null,
      };

      const plan = await billingService.createPlan(input);
      await auditLogRepository.record({
        operatorExternalUserId: request.platformOperator!.externalUserId,
        operatorEmail: request.platformOperator!.primaryEmail,
        action: 'CREATE_PLAN',
        metadata: { planId: plan.id, name: plan.name },
      });
      return reply.status(201).send(plan);
    },
  );

  server.patch<{ Params: PlanIdParams; Body: UpdatePlanBody }>(
    `${prefix}/plans/:planId`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const patch: UpdatePlanServiceInput = request.body;
      const plan = await billingService.updatePlan(request.params.planId, patch);

      if (!plan) {
        return reply.status(404).send({ error: 'Plano não encontrado.' });
      }

      await auditLogRepository.record({
        operatorExternalUserId: request.platformOperator!.externalUserId,
        operatorEmail: request.platformOperator!.primaryEmail,
        action: 'UPDATE_PLAN',
        metadata: { planId: plan.id, patch },
      });
      return reply.status(200).send(plan);
    },
  );

  /**
   * Gera um link de checkout Stripe pra um plano (tipicamente enterprise/
   * privado) e manda pro contato informado — mesmo mecanismo do upgrade
   * self-service (`BillingService.createCheckoutSession`), disparado pelo
   * operador. Sem fluxo nenhum fora do Stripe: nada é atribuído direto no
   * banco, só uma Checkout Session real, com rastreamento de conversão em
   * `enterprise_checkout_links`.
   */
  server.post<{ Params: TenantIdParams; Body: CreateEnterpriseCheckoutLinkBody }>(
    `${prefix}/tenants/:tenantId/enterprise-checkout-links`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { planId, contactEmail } = request.body;

      if (!planId || !contactEmail) {
        return reply.status(400).send({ error: 'Os campos "planId" e "contactEmail" são obrigatórios.' });
      }

      try {
        const link = await billingService.createEnterpriseCheckoutLink(
          tenantId,
          planId,
          contactEmail,
          request.platformOperator!.primaryEmail,
        );

        sendEnterpriseCheckoutLinkEmailBestEffort(notificationService, tenantRepository, planRepository, link);

        await auditLogRepository.record({
          operatorExternalUserId: request.platformOperator!.externalUserId,
          operatorEmail: request.platformOperator!.primaryEmail,
          action: 'CREATE_ENTERPRISE_CHECKOUT_LINK',
          targetTenantId: tenantId,
          metadata: { planId, contactEmail, linkId: link.id },
        });
        return reply.status(201).send(link);
      } catch (error) {
        if (error instanceof BillingError) {
          return reply.status(BILLING_ERROR_STATUS[error.code]).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  /** Links de checkout enterprise de um tenant só, mais recente primeiro. */
  server.get<{ Params: TenantIdParams }>(
    `${prefix}/tenants/:tenantId/enterprise-checkout-links`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const links = await enterpriseCheckoutLinkRepository.findAllByTenant(request.params.tenantId);
      return reply.status(200).send(links);
    },
  );

  /**
   * Painel cross-tenant de conversão — todo link enterprise já gerado, de
   * todo tenant, com um resumo por cima. Mesmo padrão de `Promise.all` por
   * tenant já usado em `buildTenantOverview`/`GET {prefix}/metrics` (RLS não
   * permite uma query cross-tenant direta, então agrega por fora).
   */
  server.get(`${prefix}/enterprise-checkout-links`, { preHandler: [requirePlatformOperator] }, async (_request, reply) => {
    const tenants = await tenantRepository.findAll();
    const linksByTenant = await Promise.all(tenants.map((tenant) => enterpriseCheckoutLinkRepository.findAllByTenant(tenant.id)));
    const links = linksByTenant.flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = links.length;
    const paid = links.filter((link) => link.status === 'paid').length;
    const expired = links.filter((link) => link.status === 'expired').length;
    const pending = links.filter((link) => link.status === 'pending').length;

    return reply.status(200).send({
      links,
      summary: { total, paid, expired, pending, conversionRate: total === 0 ? 0 : paid / total },
    });
  });

  /**
   * Emite um token de sessão pro usuário-alvo — mesma forma de
   * `AuthTokenPayload` de sempre, com `impersonatedBy` preenchido (marca a
   * sessão, usado pro audit log de toda escrita — ver `require-auth.ts`) e
   * `systemRole` **sempre `'ADMIN'`, independente do papel real do
   * usuário-alvo** — decisão deliberada (não read-only, ver histórico desta
   * rodada): o operador tem acesso completo naquele tenant enquanto
   * impersona, não só o que o usuário-alvo teria. `id`/`primaryEmail`/
   * `avatarUrl` no `user` da resposta continuam sendo os da pessoa de
   * verdade — é só o `systemRole` do token que é elevado.
   * `markLoggedIn`/`last_login_at` não são tocados: isso não é um login de
   * verdade do usuário-alvo.
   */
  server.post<{ Params: ImpersonateParams }>(
    `${prefix}/tenants/:tenantId/impersonate/:userId`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const { tenantId, userId } = request.params;
      const user: User | null = await userRepository.findById(tenantId, userId);

      if (!user) {
        return reply.status(404).send({ error: 'Usuário não encontrado neste tenant.' });
      }

      const accessToken = signImpersonationToken({
        userId: user.id,
        tenantId,
        systemRole: 'ADMIN',
        primaryEmail: user.primaryEmail,
        impersonatedBy: request.platformOperator!.externalUserId,
      });

      await auditLogRepository.record({
        operatorExternalUserId: request.platformOperator!.externalUserId,
        operatorEmail: request.platformOperator!.primaryEmail,
        action: 'START_IMPERSONATION',
        targetTenantId: tenantId,
        targetUserId: user.id,
      });

      return reply.status(200).send({ accessToken, expiresIn: IMPERSONATION_TOKEN_EXPIRES_IN_SECONDS, user });
    },
  );

  /**
   * Encerramento deliberado — não invalida o JWT de verdade (sem revogação),
   * só deixa registrado no audit log que foi um "saiu" e não um "expirou
   * sozinho". "Voltar a ser operador" é
   * local no front (descarta este token, volta a usar o de operador que já
   * tinha guardado) — não depende de mais nada daqui.
   *
   * **Não usa `requireAuth`/`requirePlatformOperator` de propósito** — é o
   * único `POST` que precisa aceitar um token de impersonation (é
   * literalmente pra encerrar um), e `requireAuth` bloqueia toda escrita
   * quando `impersonatedBy` está presente (ver `require-auth.ts`). Verifica
   * o token na mão, só pra este caso específico.
   */
  server.post(`${prefix}/end-impersonation`, async (request, reply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined;

    if (!token) {
      return reply.status(401).send({ error: 'Token de autenticação ausente.' });
    }

    let user: ReturnType<typeof verifyAuthToken>;
    try {
      user = verifyAuthToken(token);
    } catch {
      return reply.status(401).send({ error: 'Token de autenticação inválido ou expirado.' });
    }

    if (!user.impersonatedBy) {
      return reply.status(400).send({ error: 'Este token não é de uma sessão de impersonation.' });
    }

    await auditLogRepository.record({
      operatorExternalUserId: user.impersonatedBy,
      operatorEmail: user.primaryEmail,
      action: 'END_IMPERSONATION',
      targetTenantId: user.tenantId,
      targetUserId: user.userId,
    });

    return reply.status(204).send();
  });

  /** Ações mais recentes primeiro. `tenantId` opcional filtra só o que teve aquele tenant como alvo. `limit` default 50, máx 200. */
  server.get<{ Querystring: AuditLogQuery }>(
    `${prefix}/audit-log`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const parsedLimit = request.query.limit ? Number(request.query.limit) : 50;
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
        return reply.status(400).send({ error: '"limit" precisa ser um inteiro entre 1 e 200.' });
      }

      const entries = await auditLogRepository.findRecent({
        tenantId: request.query.tenantId,
        limit: parsedLimit,
      });
      return reply.status(200).send(entries);
    },
  );

  /**
   * MRR + funil de conversão, cross-tenant — retrato do agora, não série
   * temporal (ver `docs/BACKLOG.md` pra extensão futura). Mesmo padrão de
   * `Promise.all` por tenant já usado em `GET {prefix}/tenants`.
   *
   * **MRR só conta `status: 'active'`** (`trialing`/`past_due`/`cancelled`/
   * `expired` não são receita recorrente confiável) e normaliza plano anual
   * pra mensal (`priceCents / 12`) — senão infla 12x. Agrupado por moeda
   * (`plans.currency` permite mais de uma, mesmo só existindo `USD` hoje).
   *
   * **`funnel.tenantsCreated`/`everConvertedToPaid`/`delinquency.*`** vêm de
   * `subscription_history.reason` (`tenant_created`/`checkout_completed`/
   * `payment_failed`/`payment_recovered`, gravados em `billing.service.ts`),
   * contando tenants distintos — não `COUNT(*)` de linhas nem de `tenants`
   * (esse último incluiria tenant antigo/fixture que nunca passou pelo
   * provisionamento de verdade).
   *
   * **`delinquency`**: `payment_failed`/`payment_recovered` só gravam uma
   * linha na transição de verdade (primeira falha do ciclo / primeira
   * recuperação depois de `past_due`), não em toda falha/pagamento repetido
   * — ver os handlers `onInvoicePaymentFailed`/`onInvoicePaid`. Isso deixou
   * de ser um gap conhecido (era, quando só o status atual era atualizado
   * sem histórico).
   */
  server.get(`${prefix}/metrics`, { preHandler: [requirePlatformOperator] }, async (_request, reply) => {
    const [tenants, plans] = await Promise.all([tenantRepository.findAll(), planRepository.findAll()]);
    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    const perTenant = await Promise.all(
      tenants.map(async (tenant) => {
        const [subscription, history] = await Promise.all([
          subscriptionRepository.findByTenantId(tenant.id),
          subscriptionHistoryRepository.findAllByTenant(tenant.id),
        ]);
        return { tenant, subscription, history };
      }),
    );

    interface PlanMrrBucket {
      readonly planId: string;
      readonly name: string;
      readonly displayName: string;
      subscriberCount: number;
      mrrCents: number;
    }
    const mrrByCurrency = new Map<string, { totalCents: number; byPlan: Map<string, PlanMrrBucket> }>();

    for (const { subscription } of perTenant) {
      if (!subscription || subscription.status !== 'active') {
        continue;
      }
      const plan = planById.get(subscription.planId);
      if (!plan) {
        continue;
      }

      const monthlyEquivalentCents =
        plan.billingPeriod === 'annual' ? Math.round(plan.priceCents / 12) : plan.priceCents;

      const currencyBucket = mrrByCurrency.get(plan.currency) ?? { totalCents: 0, byPlan: new Map() };
      currencyBucket.totalCents += monthlyEquivalentCents;

      const planBucket = currencyBucket.byPlan.get(plan.id) ?? {
        planId: plan.id,
        name: plan.name,
        displayName: plan.displayName,
        subscriberCount: 0,
        mrrCents: 0,
      };
      planBucket.subscriberCount += 1;
      planBucket.mrrCents += monthlyEquivalentCents;
      currencyBucket.byPlan.set(plan.id, planBucket);

      mrrByCurrency.set(plan.currency, currencyBucket);
    }

    const mrr = {
      byCurrency: [...mrrByCurrency.entries()].map(([currency, bucket]) => ({
        currency,
        totalCents: bucket.totalCents,
        byPlan: [...bucket.byPlan.values()].sort((a, b) => b.mrrCents - a.mrrCents),
      })),
    };

    const tenantsCreatedIds = new Set<string>();
    const everConvertedIds = new Set<string>();
    const everWentPastDueIds = new Set<string>();
    const everRecoveredIds = new Set<string>();
    for (const { tenant, history } of perTenant) {
      for (const entry of history) {
        if (entry.reason === 'tenant_created') {
          tenantsCreatedIds.add(tenant.id);
        }
        if (entry.reason === 'checkout_completed') {
          everConvertedIds.add(tenant.id);
        }
        if (entry.reason === 'payment_failed') {
          everWentPastDueIds.add(tenant.id);
        }
        if (entry.reason === 'payment_recovered') {
          everRecoveredIds.add(tenant.id);
        }
      }
    }

    const statusCounts = new Map<SubscriptionStatus, number>(ALL_SUBSCRIPTION_STATUSES.map((status) => [status, 0]));
    let freeCount = 0;
    let paidCount = 0;
    for (const { subscription } of perTenant) {
      if (!subscription) {
        continue;
      }
      statusCounts.set(subscription.status, (statusCounts.get(subscription.status) ?? 0) + 1);

      const plan = planById.get(subscription.planId);
      if (plan) {
        if (plan.priceCents > 0) {
          paidCount += 1;
        } else {
          freeCount += 1;
        }
      }
    }

    const tenantsCreated = tenantsCreatedIds.size;
    const everConvertedToPaid = everConvertedIds.size;
    const everWentPastDue = everWentPastDueIds.size;
    const everRecoveredFromPastDue = everRecoveredIds.size;

    const funnel = {
      tenantsCreated,
      everConvertedToPaid,
      conversionRate: tenantsCreated > 0 ? everConvertedToPaid / tenantsCreated : 0,
      currentByStatus: ALL_SUBSCRIPTION_STATUSES.map((status) => ({ status, count: statusCounts.get(status) ?? 0 })),
      currentByTier: { free: freeCount, paid: paidCount },
      delinquency: {
        everWentPastDue,
        everRecoveredFromPastDue,
        recoveryRate: everWentPastDue > 0 ? everRecoveredFromPastDue / everWentPastDue : 0,
      },
    };

    return reply.status(200).send({ mrr, funnel });
  });
}
