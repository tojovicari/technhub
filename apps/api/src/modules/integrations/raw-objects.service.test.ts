import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  rawObject: {
    createMany: vi.fn(),
  },
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { persistRawSyncObjects } from './raw-objects.service.js';

describe('persistRawSyncObjects', () => {
  beforeEach(() => {
    mockPrisma.rawObject.createMany.mockReset();
    mockPrisma.rawObject.createMany.mockResolvedValue({ count: 0 });
  });

  it('persists sync objects as sync_incremental raw rows', async () => {
    mockPrisma.rawObject.createMany.mockResolvedValue({ count: 2 });

    const result = await persistRawSyncObjects({
      tenantId: 'ten_test',
      connectionId: 'conn-1',
      provider: 'github',
      entityType: 'issue',
      mode: 'incremental',
      objects: [
        { id: '1', created_at: '2026-07-17T10:00:00.000Z' },
        { id: '2', created_at: '2026-07-17T11:00:00.000Z' },
      ],
      getExternalId: (object) => object.id,
      getOccurredAt: (object) => object.created_at,
    });

    expect(mockPrisma.rawObject.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            tenantId: 'ten_test',
            connectionId: 'conn-1',
            provider: 'github',
            entityType: 'issue',
            externalId: '1',
            sourceChannel: 'sync_incremental',
            processingStatus: 'queued',
          }),
        ]),
      })
    );

    expect(result).toEqual({ inserted: 2, deduplicated: 0 });
  });

  it('skips objects without an external id', async () => {
    const result = await persistRawSyncObjects({
      tenantId: 'ten_test',
      connectionId: 'conn-1',
      provider: 'jira',
      entityType: 'project',
      mode: 'full',
      objects: [{}, { foo: 'bar' }],
      getExternalId: () => undefined,
    });

    expect(mockPrisma.rawObject.createMany).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, deduplicated: 0 });
  });
});