import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { listNotificationsQuerySchema } from './schema.js';
import { listNotifications, retryNotification } from './service.js';

export async function commsRoutes(app: FastifyInstance): Promise<void> {
  // GET /comms/notifications
  app.get('/comms/notifications', {
    preHandler: [app.authenticate, app.requirePermission('comms.notifications.read')],
  }, async (request, reply) => {
    const parsed = listNotificationsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query parameters', { issues: parsed.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const result = await listNotifications(tenantId, parsed.data);
    return reply.status(200).send(ok(request, result));
  });

  // POST /comms/notifications/:id/retry
  app.post('/comms/notifications/:id/retry', {
    preHandler: [app.authenticate, app.requirePermission('comms.notifications.retry')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;

    const result = await retryNotification(id, tenantId);
    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Notification not found or not in failed state'));
    }

    return reply.status(200).send(ok(request, result));
  });
}
