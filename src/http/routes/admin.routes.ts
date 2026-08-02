import type { FastifyInstance } from 'fastify';
import { TenantRepository } from '../../identity/tenant.repository';
import { UserRepository } from '../../identity/user.repository';
import { TeamRepository } from '../../identity/team.repository';
import { ProviderIntegrationRepository } from '../../integrations/repositories/provider-integration.repository';
import { PlanRepository } from '../../billing/plan.repository';
import { SubscriptionRepository } from '../../billing/subscription.repository';
import { BillingService } from '../../billing/billing.service';
import type { CreatePlanServiceInput, UpdatePlanServiceInput } from '../../billing/billing.service';
import { BillingError } from '../../billing/billing-errors';
import type { Tenant } from '../../identity/identity.types';
import type { Subscription, Plan } from '../../billing/billing.types';
import { requirePlatformOperator } from '../middleware/require-platform-operator';
import { getPlatformAdminRoutePrefix } from '../../config/platform-admin-route-prefix';

interface TenantIdParams {
  readonly tenantId: string;
}
interface PlanIdParams {
  readonly planId: string;
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
}

interface UpdatePlanBody {
  readonly displayName?: string;
  readonly priceCents?: number;
  readonly currency?: string;
  readonly billingPeriod?: string;
  readonly trialDays?: number;
  readonly isPublic?: boolean;
  readonly isActive?: boolean;
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

  server.post<{ Params: TenantIdParams }>(
    `${prefix}/tenants/:tenantId/suspend`,
    { preHandler: [requirePlatformOperator] },
    async (request, reply) => {
      const tenant = await tenantRepository.updateStatus(request.params.tenantId, 'SUSPENDED');
      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant não encontrado.' });
      }
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
        return reply.status(200).send(result);
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
      const { name, displayName, priceCents, currency, billingPeriod, trialDays, isPublic, isActive } = request.body;

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
      };

      const plan = await billingService.createPlan(input);
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

      return reply.status(200).send(plan);
    },
  );
}
