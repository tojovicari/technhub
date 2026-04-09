import type { FastifyInstance } from 'fastify';
import { processPendingWebhookEvents } from './webhooks.js';

export function startIntegrationsWorker(app: FastifyInstance) {
  const intervalMs = Number(process.env.WEBHOOK_WORKER_INTERVAL_MS || 2000);

  const timer = setInterval(async () => {
    try {
      await processPendingWebhookEvents(20);
    } catch (error) {
      app.log.error({ error }, 'Webhook worker execution failed');
    }
  }, intervalMs);

  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
}
