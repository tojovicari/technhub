import type { FastifyInstance } from 'fastify';
import { AlertRepository } from '../../alerts/alert.repository';
import { isValidUuid } from '../uuid';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { requireSameTenant } from '../middleware/require-same-tenant';

const requireAdminOrManager = requireRole('ADMIN', 'GESTOR');

interface TenantParams {
  readonly tenantId: string;
}

interface TenantAlertParams extends TenantParams {
  readonly alertId: string;
}

interface ListAlertsQuery {
  readonly unread?: string;
  readonly limit?: string;
}

/**
 * Registra as rotas de Alertas in-app — leitura/gestão pela UI de sino.
 * Criação nunca acontece por rota HTTP: alertas só são gravados pelos
 * pontos internos de gatilho (sync finished, staleness scan, reconexão,
 * billing webhook) — ver `AlertRepository` e os call sites em
 * `sync.orchestrator.ts`, `integrations.routes.ts`, `internal.routes.ts` e
 * `billing.service.ts`.
 */
export function registerAlertRoutes(
  server: FastifyInstance,
  alertRepository: AlertRepository = new AlertRepository(),
): void {
  /** Mais recentes primeiro. `limit` default 50, máx 200 — mesmo padrão de `GET {prefix}/audit-log` (`admin.routes.ts`). */
  server.get<{ Params: TenantParams; Querystring: ListAlertsQuery }>(
    '/tenants/:tenantId/alerts',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;

      const parsedLimit = request.query.limit ? Number(request.query.limit) : 50;
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
        return reply.status(400).send({ error: '"limit" precisa ser um inteiro entre 1 e 200.' });
      }

      const alerts = await alertRepository.findAllByTenant(tenantId, {
        unreadOnly: request.query.unread === 'true',
        limit: parsedLimit,
      });
      return reply.status(200).send(alerts);
    },
  );

  server.patch<{ Params: TenantAlertParams }>(
    '/tenants/:tenantId/alerts/:alertId/read',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, alertId } = request.params;
      if (!isValidUuid(alertId)) {
        return reply.status(404).send({ error: 'Alerta não encontrado para este tenant.' });
      }
      const found = await alertRepository.markRead(tenantId, alertId);
      if (!found) {
        return reply.status(404).send({ error: 'Alerta não encontrado para este tenant.' });
      }
      return reply.status(204).send();
    },
  );

  server.patch<{ Params: TenantParams }>(
    '/tenants/:tenantId/alerts/read-all',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      await alertRepository.markAllRead(request.params.tenantId);
      return reply.status(204).send();
    },
  );
}
