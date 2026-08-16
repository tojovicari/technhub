import type { FastifyInstance } from 'fastify';
import { TimelineEventRepository } from '../../dashboard/timeline-event.repository';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { requireSameTenant } from '../middleware/require-same-tenant';
import { getPgErrorCode } from '../pg-error';
import { isValidUuid } from '../uuid';
import { parseOptionalPeriod } from './period-query.util';

const requireAdminOrManager = requireRole('ADMIN', 'GESTOR');

interface TenantParams {
  readonly tenantId: string;
}
interface TenantEventParams extends TenantParams {
  readonly eventId: string;
}

interface CreateTimelineEventBody {
  readonly title?: string;
  readonly description?: string;
  readonly eventDate?: string;
  readonly teamId?: string;
}

interface TimelineEventQuery {
  readonly teamId?: string;
  readonly from?: string;
  readonly to?: string;
}

/**
 * Eventos manuais (desligamento, troca de versão, reorg...) pra sobrepor
 * como marcador visual em qualquer gráfico temporal — recurso independente
 * de `/dashboard/dora/history` de propósito (ver plano: já existem 3
 * gráficos semanais diferentes, acoplar a um só resolveria um caso).
 *
 * RBAC: criar/apagar é mutação de dado compartilhado da organização →
 * `ADMIN`/`GESTOR` (mesmo tier de `team-resource-links`). Listar é leitura
 * de dashboard → qualquer papel autenticado do tenant, sem `requireRole`
 * (mesma regra de `dashboard.routes.ts`).
 */
export function registerTimelineEventRoutes(
  server: FastifyInstance,
  timelineEventRepository: TimelineEventRepository = new TimelineEventRepository(),
): void {
  server.post<{ Params: TenantParams; Body: CreateTimelineEventBody }>(
    '/tenants/:tenantId/timeline-events',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { title, description, eventDate, teamId } = request.body;

      if (!title) {
        return reply.status(400).send({ error: 'O campo "title" é obrigatório.' });
      }

      const parsedEventDate = eventDate ? new Date(eventDate) : null;
      if (!parsedEventDate || Number.isNaN(parsedEventDate.getTime())) {
        return reply.status(400).send({ error: '"eventDate" precisa ser uma data ISO 8601 válida.' });
      }

      try {
        const event = await timelineEventRepository.create(tenantId, {
          teamId: teamId ?? null,
          title,
          description: description ?? null,
          eventDate: parsedEventDate,
          createdByUserId: request.user!.userId,
        });
        return reply.status(201).send(event);
      } catch (error) {
        if (getPgErrorCode(error) === '23503') {
          return reply.status(404).send({ error: 'Tenant, time ou usuário não encontrado.' });
        }
        throw error;
      }
    },
  );

  server.get<{ Params: TenantParams; Querystring: TimelineEventQuery }>(
    '/tenants/:tenantId/timeline-events',
    { preHandler: [requireAuth, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { teamId, from, to } = request.query;

      const period = parseOptionalPeriod(from, to);
      if (period === 'invalid') {
        return reply.status(400).send({ error: '"from"/"to" precisam ser datas ISO 8601 válidas, os dois presentes ou os dois ausentes.' });
      }

      const range = period ?? { from: new Date(0), to: new Date('9999-12-31T23:59:59.999Z') };
      const events = await timelineEventRepository.findInRange(tenantId, teamId ?? null, range.from, range.to);
      return reply.status(200).send(events);
    },
  );

  server.delete<{ Params: TenantEventParams }>(
    '/tenants/:tenantId/timeline-events/:eventId',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, eventId } = request.params;

      if (!isValidUuid(eventId)) {
        return reply.status(404).send({ error: 'Evento não encontrado.' });
      }

      const deleted = await timelineEventRepository.delete(tenantId, eventId);
      if (!deleted) {
        return reply.status(404).send({ error: 'Evento não encontrado.' });
      }

      return reply.status(204).send();
    },
  );
}
