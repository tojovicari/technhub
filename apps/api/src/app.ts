import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { authRoutes } from './modules/auth/routes.js';
import { coreRoutes } from './modules/core/routes.js';
import { integrationsRoutes } from './modules/integrations/routes.js';
import { integrationWebhookRoutes } from './modules/integrations/webhook-routes.js';
import { startIntegrationsWorker } from './modules/integrations/worker.js';
import { startSlaScheduler } from './modules/sla/worker.js';
import { slaRoutes } from './modules/sla/routes.js';
import { doraRoutes } from './modules/dora/routes.js';
import { cogsRoutes } from './modules/cogs/routes.js';
import { intelRoutes } from './modules/intel/routes.js';
import { iamRoutes } from './modules/iam/routes.js';
import { commsRoutes } from './modules/comms/routes.js';
import { startCommsWorker } from './modules/comms/worker.js';
import { billingRoutes } from './modules/billing/routes.js';
import { platformBillingRoutes } from './modules/billing/platform-routes.js';
import { billingWebhookRoutes } from './modules/billing/webhook-routes.js';
import { startBillingWorker } from './modules/billing/worker.js';
import { registerAuth } from './plugins/auth.js';
import { loadEntitlement } from './modules/billing/entitlement.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  const extraOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? ['https://app.moasy.tech', 'https://moasy.tech', 'https://www.moasy.tech', ...extraOrigins]
    : true;

  app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.register(helmet);
  registerAuth(app);

  // Hook para injetar header X-Billing-Warning
  app.addHook('onSend', async (request, reply) => {
    const user = request.user as { tenant_id?: string } | undefined;
    if (!user?.tenant_id) return;

    try {
      const ent = await loadEntitlement(user.tenant_id);

      if (ent.status === 'past_due') {
        reply.header('X-Billing-Warning', 'past_due');
      } else if (ent.status === 'downgraded') {
        reply.header('X-Billing-Warning', 'downgraded');
      } else if (ent.status === 'trialing' && ent.trialEndsAt) {
        const daysLeft = Math.ceil((ent.trialEndsAt.getTime() - Date.now()) / 86_400_000);
        if (daysLeft <= 3) reply.header('X-Billing-Warning', 'trial_ending');
      } else if (ent.status === 'cancelled') {
        reply.header('X-Billing-Warning', 'cancellation_scheduled');
      }
    } catch {
      // Silently ignore se não conseguir carregar entitlement
    }
  });

  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'cto-ai-api',
      timestamp: new Date().toISOString()
    };
  });

  app.get('/ready', async () => {
    return {
      status: 'ready'
    };
  });

  app.register(integrationsRoutes, { prefix: '/api/v1' });
  app.register(integrationWebhookRoutes, { prefix: '/api/v1' });
  app.register(authRoutes, { prefix: '/api/v1' });
  app.register(coreRoutes, { prefix: '/api/v1' });
  app.register(slaRoutes, { prefix: '/api/v1' });
  app.register(doraRoutes, { prefix: '/api/v1' });
  app.register(cogsRoutes, { prefix: '/api/v1' });
  app.register(intelRoutes, { prefix: '/api/v1' });
  app.register(iamRoutes, { prefix: '/api/v1' });
  app.register(commsRoutes, { prefix: '/api/v1' });
  app.register(billingRoutes, { prefix: '/api/v1' });
  app.register(platformBillingRoutes, { prefix: '/api/v1' });
  app.register(billingWebhookRoutes, { prefix: '/api/v1' });
  startIntegrationsWorker(app);
  startSlaScheduler(app);
  startCommsWorker(app);
  startBillingWorker(app);

  return app;
}
