import type { FastifyInstance } from 'fastify';
import { processQueue } from './service.js';

const INTERVAL_MS = Number(process.env.COMMS_WORKER_INTERVAL_MS || 5_000);

export function startCommsWorker(app: FastifyInstance): void {
  const timer = setInterval(async () => {
    try {
      await processQueue(20, app.log);
    } catch (error) {
      app.log.error({ error }, 'Comms worker execution failed');
    }
  }, INTERVAL_MS);

  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
}
