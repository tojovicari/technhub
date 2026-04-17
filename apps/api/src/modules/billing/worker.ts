import type { FastifyInstance } from 'fastify';
import { applyPendingChanges } from './jobs/apply-pending-changes.js';
import { enforcePastDueDowngrade } from './jobs/enforce-past-due.js';
import { purgeTenantData } from './jobs/purge-tenant-data.js';

// Intervalos
const SIX_HOURS = 6 * 60 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

export function startBillingWorker(app: FastifyInstance): void {
  const logger = app.log.child({ worker: 'billing' }) as any;

  // Job 1: Apply Pending Changes (a cada 6 horas)
  const applyChangesTimer = setInterval(async () => {
    try {
      await applyPendingChanges(logger);
    } catch (error) {
      logger.error({ error }, 'Apply pending changes job failed');
    }
  }, SIX_HOURS);

  // Job 2: Enforce Past Due (a cada hora)
  const enforcePastDueTimer = setInterval(async () => {
    try {
      await enforcePastDueDowngrade(logger);
    } catch (error) {
      logger.error({ error }, 'Enforce past due job failed');
    }
  }, ONE_HOUR);

  // Job 3: Purge Tenant Data (a cada 24 horas)
  // Para rodar às 3am, calcular o delay até o próximo 3am
  const purgeTimer = setInterval(async () => {
    const now = new Date();
    const hours = now.getUTCHours();

    // Rodar apenas às 3am UTC (ajustar timezone se necessário)
    if (hours === 3) {
      try {
        await purgeTenantData(logger);
      } catch (error) {
        logger.error({ error }, 'Purge tenant data job failed');
      }
    }
  }, ONE_HOUR); // Checa a cada hora, mas só executa às 3am

  // Executar jobs imediatamente na inicialização (opcional - comentado por segurança)
  // applyPendingChanges(logger).catch(err => logger.error({ err }, 'Initial apply pending changes failed'));
  // enforcePastDueDowngrade(logger).catch(err => logger.error({ err }, 'Initial enforce past due failed'));

  // Cleanup ao fechar servidor
  app.addHook('onClose', async () => {
    clearInterval(applyChangesTimer);
    clearInterval(enforcePastDueTimer);
    clearInterval(purgeTimer);
    logger.info('Billing worker stopped');
  });

  logger.info({
    applyChangesInterval: `${SIX_HOURS / 1000 / 60 / 60}h`,
    enforcePastDueInterval: `${ONE_HOUR / 1000 / 60 / 60}h`,
    purgeInterval: 'daily at 3am UTC'
  }, 'Billing worker started');
}
