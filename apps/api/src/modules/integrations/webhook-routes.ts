import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import {
  enqueueWebhookEvent,
  resolveExternalEventId,
  resolveWebhookEventType,
  verifyWebhookToken
} from './webhooks.js';

export async function integrationWebhookRoutes(app: FastifyInstance) {
  app.post('/integrations/webhooks/:provider/:tenant_id', async (request, reply) => {
    const { provider, tenant_id: tenantId } = request.params as {
      provider: string;
      tenant_id: string;
    };

    if (provider !== 'jira' && provider !== 'github') {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Unsupported provider'));
    }

    const authenticated = verifyWebhookToken(provider, request.headers);
    if (!authenticated) {
      return reply.status(401).send(fail(request, 'UNAUTHORIZED', 'Invalid webhook token'));
    }

    const event = await enqueueWebhookEvent({
      tenantId,
      provider,
      externalId: resolveExternalEventId(provider, request.headers),
      eventType: resolveWebhookEventType(provider, request.headers),
      payload: request.body
    });

    return reply.status(202).send(ok(request, {
      event_id: event.id,
      provider: event.provider,
      status: event.status,
      received_at: event.receivedAt.toISOString()
    }));
  });

  app.get('/integrations/webhooks/events/:event_id', {
    preHandler: [app.authenticate, app.requirePermission('integrations.webhook.read')]
  }, async (request, reply) => {
    const { event_id: eventId } = request.params as { event_id: string };

    const event = await prisma.integrationWebhookEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Webhook event not found'));
    }

    const tenantScopeError = ensureTenantScope(request, reply, event.tenantId);
    if (tenantScopeError) {
      return tenantScopeError;
    }

    return reply.status(200).send(ok(request, {
      id: event.id,
      tenant_id: event.tenantId,
      provider: event.provider,
      external_id: event.externalId,
      event_type: event.eventType,
      status: event.status,
      attempts: event.attempts,
      last_error: event.lastError,
      received_at: event.receivedAt.toISOString(),
      processed_at: event.processedAt?.toISOString() ?? null
    }));
  });
}
