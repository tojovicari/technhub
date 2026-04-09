import { randomUUID } from 'crypto';
import type { IntegrationProvider } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { createSyncJob } from './service.js';

type EnqueueInput = {
  tenantId: string;
  provider: IntegrationProvider;
  externalId: string;
  eventType: string;
  payload: unknown;
};

export async function enqueueWebhookEvent(input: EnqueueInput) {
  const existing = await prisma.integrationWebhookEvent.findUnique({
    where: {
      provider_externalId: {
        provider: input.provider,
        externalId: input.externalId
      }
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.integrationWebhookEvent.create({
    data: {
      tenantId: input.tenantId,
      provider: input.provider,
      externalId: input.externalId,
      eventType: input.eventType,
      payload: input.payload as object
    }
  });
}

export function resolveExternalEventId(
  provider: IntegrationProvider,
  headers: Record<string, string | string[] | undefined>
) {
  const h = (key: string) => {
    const value = headers[key];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  };

  if (provider === 'github') {
    return h('x-github-delivery') || randomUUID();
  }

  return h('x-atlassian-webhook-identifier') || h('x-webhook-id') || randomUUID();
}

export function resolveWebhookEventType(
  provider: IntegrationProvider,
  headers: Record<string, string | string[] | undefined>
) {
  const h = (key: string) => {
    const value = headers[key];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  };

  if (provider === 'github') {
    return h('x-github-event') || 'unknown';
  }

  return h('x-atlassian-webhook-event') || 'unknown';
}

export function verifyWebhookToken(
  provider: IntegrationProvider,
  headers: Record<string, string | string[] | undefined>
) {
  const headerValue = headers['x-webhook-token'];
  const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  const expected = provider === 'github'
    ? (process.env.GITHUB_WEBHOOK_TOKEN || (process.env.NODE_ENV !== 'production' ? 'dev-github-webhook-token' : undefined))
    : (process.env.JIRA_WEBHOOK_TOKEN || (process.env.NODE_ENV !== 'production' ? 'dev-jira-webhook-token' : undefined));

  // Local fallback: if no token configured, accept only when AUTH_BYPASS=true.
  if (!expected) {
    return process.env.AUTH_BYPASS === 'true';
  }

  return token === expected;
}

async function processOneEvent(eventId: string) {
  const lock = await prisma.integrationWebhookEvent.updateMany({
    where: {
      id: eventId,
      status: 'queued'
    },
    data: {
      status: 'processing',
      attempts: {
        increment: 1
      }
    }
  });

  if (lock.count === 0) {
    return;
  }

  const event = await prisma.integrationWebhookEvent.findUnique({
    where: { id: eventId }
  });

  if (!event) {
    return;
  }

  try {
    const connection = await prisma.integrationConnection.findFirst({
      where: {
        tenantId: event.tenantId,
        provider: event.provider,
        status: 'active'
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    if (!connection) {
      throw new Error('No active integration connection for tenant/provider');
    }

    await createSyncJob({
      tenant_id: event.tenantId,
      connection_id: connection.id,
      mode: 'incremental'
    });

    await prisma.integrationWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'processed',
        processedAt: new Date(),
        lastError: null,
        connectionId: connection.id
      }
    });
  } catch (error) {
    await prisma.integrationWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'failed',
        lastError: error instanceof Error ? error.message : 'Unknown webhook processing error'
      }
    });
  }
}

let workerRunning = false;

export async function processPendingWebhookEvents(limit = 20) {
  if (workerRunning) {
    return;
  }

  workerRunning = true;
  try {
    const pending = await prisma.integrationWebhookEvent.findMany({
      where: { status: 'queued' },
      orderBy: { receivedAt: 'asc' },
      take: limit
    });

    for (const event of pending) {
      await processOneEvent(event.id);
    }
  } finally {
    workerRunning = false;
  }
}
