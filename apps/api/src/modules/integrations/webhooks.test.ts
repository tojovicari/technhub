import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  rawObject: { upsert: vi.fn() },
  integrationWebhookEvent: { findUnique: vi.fn(), create: vi.fn() },
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('./connectors/registry.js', () => ({
  getConnector: vi.fn(() => ({
    webhookConfig: {
      eventIdHeader: 'x-test-event-id',
      eventTypeHeader: 'x-test-event-type',
      tokenEnvVar: 'TEST_WEBHOOK_TOKEN',
      devToken: 'dev-token',
    },
  })),
}));

import { enqueueWebhookEvent } from './webhooks.js';

describe('enqueueWebhookEvent', () => {
  beforeEach(() => {
    mockPrisma.rawObject.upsert.mockReset();
    mockPrisma.integrationWebhookEvent.findUnique.mockReset();
    mockPrisma.integrationWebhookEvent.create.mockReset();

    mockPrisma.rawObject.upsert.mockResolvedValue({ id: 'raw-1' });
    mockPrisma.integrationWebhookEvent.findUnique.mockResolvedValue(null);
    mockPrisma.integrationWebhookEvent.create.mockResolvedValue({ id: 'evt-1' });
  });

  it('persists webhook payload as a raw object before queueing the event', async () => {
    await enqueueWebhookEvent({
      tenantId: 'ten_test',
      provider: 'github',
      externalId: 'delivery-1',
      eventType: 'push',
      payload: { action: 'opened', issue: { id: 1 } },
    });

    expect(mockPrisma.rawObject.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tenantId: 'ten_test',
          provider: 'github',
          entityType: 'push',
          externalId: 'delivery-1',
          sourceChannel: 'webhook',
          processingStatus: 'queued',
        }),
        update: expect.objectContaining({
          lastSeenAt: expect.any(Date),
        }),
      })
    );

    expect(mockPrisma.integrationWebhookEvent.create).toHaveBeenCalled();
  });

  it('returns the existing webhook event when already queued', async () => {
    mockPrisma.integrationWebhookEvent.findUnique.mockResolvedValue({ id: 'evt-existing' });

    const result = await enqueueWebhookEvent({
      tenantId: 'ten_test',
      provider: 'jira',
      externalId: 'delivery-2',
      eventType: 'issue',
      payload: { id: 2 },
    });

    expect(result).toEqual({ id: 'evt-existing' });
    expect(mockPrisma.rawObject.upsert).toHaveBeenCalled();
  });
});