import type { FastifyInstance } from 'fastify';
import { BillingService } from '../../billing/billing.service';
import { BillingError } from '../../billing/billing-errors';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { requireSameTenant } from '../middleware/require-same-tenant';

// CLAUDE.md — RBAC: "ADMIN: gestão do tenant, faturamento, integrações, convites e configs globais."
const requireAdmin = requireRole('ADMIN');

interface TenantParams {
  readonly tenantId: string;
}

interface CheckoutBody {
  readonly planId?: string;
  readonly successUrl?: string;
  readonly cancelUrl?: string;
}

interface PortalBody {
  readonly returnUrl?: string;
}

interface DowngradeToFreeBody {
  readonly planId?: string;
}

const BILLING_ERROR_STATUS: Record<BillingError['code'], number> = {
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  PRECONDITION_FAILED: 422,
};

/**
 * Registra as rotas de Billing/Assinatura (Fase 1) — só `ADMIN`, checkout
 * e portal via Stripe, cancelamento agendado. Webhook do Stripe fica em
 * `billing-webhook.routes.ts` (sem auth, verificado por assinatura HMAC).
 */
export function registerBillingRoutes(
  server: FastifyInstance,
  billingService: BillingService = new BillingService(),
): void {
  /**
   * Pública, sem auth — pensada pra landing page/site de marketing
   * (server-side/build-time, nunca fetch direto do navegador: CORS não
   * libera essa origem, ver `server.ts`). Mesmo filtro `isPublic && isActive`
   * do checkout (`billingService.listPlans` → `PlanRepository.findPublicActive`),
   * sem duplicar a regra. Omite `stripePriceId` (referência interna, sem
   * motivo pra expor) — todo o resto do shape de `Plan` é informação de
   * preço, já pensada pra ser pública.
   */
  server.get('/plans', async (_request, reply) => {
    const plans = await billingService.listPlans();
    const publicPlans = plans.map(({ stripePriceId: _stripePriceId, ...rest }) => rest);
    return reply.status(200).send(publicPlans);
  });

  server.get<{ Params: TenantParams }>(
    '/tenants/:tenantId/billing/plans',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (_request, reply) => {
      const plans = await billingService.listPlans();
      return reply.status(200).send(plans);
    },
  );

  server.get<{ Params: TenantParams }>(
    '/tenants/:tenantId/billing/subscription',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const subscription = await billingService.getSubscription(tenantId);

      if (!subscription) {
        return reply.status(404).send({ error: 'Nenhuma assinatura encontrada para este tenant.' });
      }

      return reply.status(200).send(subscription);
    },
  );

  server.post<{ Params: TenantParams; Body: CheckoutBody }>(
    '/tenants/:tenantId/billing/checkout',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { planId, successUrl, cancelUrl } = request.body;

      if (!planId || !successUrl || !cancelUrl) {
        return reply
          .status(400)
          .send({ error: 'Os campos "planId", "successUrl" e "cancelUrl" são obrigatórios.' });
      }

      try {
        // `request.user` é garantido pelo `requireAuth` no preHandler.
        const requesterEmail = request.user!.primaryEmail;
        const result = await billingService.createCheckoutSession(
          tenantId,
          planId,
          requesterEmail,
          successUrl,
          cancelUrl,
        );
        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof BillingError) {
          return reply.status(BILLING_ERROR_STATUS[error.code]).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  server.post<{ Params: TenantParams; Body: PortalBody }>(
    '/tenants/:tenantId/billing/portal',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { returnUrl } = request.body;

      if (!returnUrl) {
        return reply.status(400).send({ error: 'O campo "returnUrl" é obrigatório.' });
      }

      try {
        const result = await billingService.createPortalSession(tenantId, returnUrl);
        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof BillingError) {
          return reply.status(BILLING_ERROR_STATUS[error.code]).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  server.post<{ Params: TenantParams }>(
    '/tenants/:tenantId/billing/cancel',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;

      try {
        const result = await billingService.cancelSubscription(tenantId);
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
   * Move o próprio tenant direto pra um plano sem cobrança (`priceCents: 0`)
   * — sem Checkout Session, já que não tem pagamento nenhum pra proteger.
   * Mesmo método usado pelo painel do gestor do SaaS
   * (`POST {prefix}/tenants/:tenantId/assign-free-plan`), ver
   * `BillingService.assignFreePlan`.
   */
  server.post<{ Params: TenantParams; Body: DowngradeToFreeBody }>(
    '/tenants/:tenantId/billing/downgrade-to-free',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { planId } = request.body;

      if (!planId) {
        return reply.status(400).send({ error: 'O campo "planId" é obrigatório.' });
      }

      try {
        const result = await billingService.assignFreePlan(tenantId, planId);
        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof BillingError) {
          return reply.status(BILLING_ERROR_STATUS[error.code]).send({ error: error.message });
        }
        throw error;
      }
    },
  );
}
