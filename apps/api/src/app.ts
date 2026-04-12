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
import { registerAuth } from './plugins/auth.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.register(helmet);
  registerAuth(app);

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
  startIntegrationsWorker(app);
  startSlaScheduler(app);

  return app;
}
