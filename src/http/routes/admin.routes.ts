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
import type { Tenant, User } from '../../identity/identity.types';
import type { Subscription, Plan } from '../../billing/billing.types';
import { PlatformOperatorAuditLogRepository } from '../../platform-admin/platform-operator-audit-log.repository';
import { requirePlatformOperator } from '../middleware/require-platform-operator';
import { signImpersonationToken, verifyAuthToken } from '../../auth/core/jwt';
import { getPlatformAdminRoutePrefix } from '../../config/platform-admin-route-prefix';

const BEARER_PREFIX = 'Bearer ';

const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 15 * 60;

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
  auditLogRepository: PlatformOperatorAuditLogRepository = new PlatformOperatorAuditLogRepository(),
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
   * Emite um token de sessão pro usuário-alvo — mesma forma de
   * `AuthTokenPayload` de sempre, só com `impersonatedBy` preenchido, o que
   * faz `requireAuth` bloquear qualquer escrita nessa sessão (ver
   * `require-auth.ts`). RBAC continua sendo o do usuário-alvo de verdade —
   * impersonar um `USUARIO` não abre nada que um `USUARIO` não veria.
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
        systemRole: user.systemRole,
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

      return reply.status(200).send({ accessToken, expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS, user });
    },
  );

  /**
   * Encerramento deliberado — não invalida o JWT de verdade (sem revogação,
   * o TTL de 15min já limita a exposição), só deixa registrado no audit log
   * que foi um "saiu" e não um "expirou sozinho". "Voltar a ser operador" é
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
}
