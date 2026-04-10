import type { FastifyInstance } from 'fastify';
import { tickSlaInstances } from './service.js';

export function startSlaScheduler(app: FastifyInstance) {
  const intervalMs = Number(process.env.SLA_SCHEDULER_INTERVAL_MS || 60_000);

  const timer = setInterval(async () => {
    try {
      const updated = await tickSlaInstances();
      if (updated > 0) {
        app.log.info({ updated }, 'SLA scheduler: instances updated');
      }
    } catch (error) {
      app.log.error({ error }, 'SLA scheduler execution failed');
    }
  }, intervalMs);

  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
}
