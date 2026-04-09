import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { coreRoutes } from './modules/core/routes.js';
import { integrationsRoutes } from './modules/integrations/routes.js';
import { integrationWebhookRoutes } from './modules/integrations/webhook-routes.js';
import { startIntegrationsWorker } from './modules/integrations/worker.js';
import { registerAuth } from './plugins/auth.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
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
  app.register(coreRoutes, { prefix: '/api/v1' });
  startIntegrationsWorker(app);

  return app;
}
