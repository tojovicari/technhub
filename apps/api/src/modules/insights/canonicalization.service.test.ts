import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  rawObject: { findMany: vi.fn() },
  canonicalFact: { upsert: vi.fn() },
  canonicalFactAttribute: { deleteMany: vi.fn(), createMany: vi.fn() },
  canonicalLineage: { upsert: vi.fn() },
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { dispatchCanonicalizationForSync } from './canonicalization.service.js';

describe('dispatchCanonicalizationForSync', () => {
  beforeEach(() => {
    mockPrisma.rawObject.findMany.mockReset();
    mockPrisma.canonicalFact.upsert.mockReset();
    mockPrisma.canonicalFactAttribute.deleteMany.mockReset();
    mockPrisma.canonicalFactAttribute.createMany.mockReset();
    mockPrisma.canonicalLineage.upsert.mockReset();
  });

  it('canonicalizes work_item, pull_request and incident raw objects', async () => {
    mockPrisma.rawObject.findMany
      .mockResolvedValueOnce([
        {
          id: 'raw-1',
          provider: 'jira',
          entityType: 'issue',
          externalId: 'JIRA-1',
          payload: { fields: { summary: 'Fix login', status: { statusCategory: { name: 'Done' } }, labels: ['backend'] } },
          occurredAt: new Date('2026-07-17T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'raw-2',
          provider: 'github',
          entityType: 'pull_request',
          externalId: 'PR-2',
          payload: { title: 'Add webhook support', state: 'closed', labels: [{ name: 'feature' }] },
          occurredAt: new Date('2026-07-17T11:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'raw-3',
          provider: 'incident_io',
          entityType: 'incident',
          externalId: 'INC-3',
          payload: { incident: { name: 'Database latency', status: 'resolved', tags: ['prod'] } },
          occurredAt: new Date('2026-07-17T12:00:00.000Z'),
        },
      ]);

    mockPrisma.canonicalFact.upsert
      .mockResolvedValueOnce({ id: 'fact-1' })
      .mockResolvedValueOnce({ id: 'fact-2' })
      .mockResolvedValueOnce({ id: 'fact-3' });

    mockPrisma.canonicalLineage.upsert
      .mockResolvedValueOnce({ id: 'lineage-1' })
      .mockResolvedValueOnce({ id: 'lineage-2' })
      .mockResolvedValueOnce({ id: 'lineage-3' });

    const jiraResult = await dispatchCanonicalizationForSync({
      tenantId: 'ten_test',
      connectionId: 'conn-1',
      provider: 'jira',
      ingestedAfter: new Date('2026-07-17T00:00:00.000Z'),
    });

    const githubResult = await dispatchCanonicalizationForSync({
      tenantId: 'ten_test',
      connectionId: 'conn-1',
      provider: 'github',
      ingestedAfter: new Date('2026-07-17T00:00:00.000Z'),
    });

    const incidentResult = await dispatchCanonicalizationForSync({
      tenantId: 'ten_test',
      connectionId: 'conn-1',
      provider: 'incident_io',
      ingestedAfter: new Date('2026-07-17T00:00:00.000Z'),
    });

    expect(jiraResult).toEqual({ canonicalized: 1, skipped: 0, warnings: [] });
    expect(githubResult).toEqual({ canonicalized: 1, skipped: 0, warnings: [] });
    expect(incidentResult).toEqual({ canonicalized: 1, skipped: 0, warnings: [] });
    expect(mockPrisma.canonicalFact.upsert).toHaveBeenCalledTimes(3);
    expect(mockPrisma.canonicalLineage.upsert).toHaveBeenCalledTimes(3);
  });

  it('skips unsupported raw objects', async () => {
    mockPrisma.rawObject.findMany.mockResolvedValue([
      {
        id: 'raw-4',
        provider: 'github',
        entityType: 'repository',
        externalId: 'repo-1',
        payload: { name: 'platform' },
        occurredAt: null,
      },
    ]);

    const result = await dispatchCanonicalizationForSync({
      tenantId: 'ten_test',
      connectionId: 'conn-1',
      provider: 'github',
      ingestedAfter: new Date('2026-07-17T00:00:00.000Z'),
    });

    expect(mockPrisma.canonicalFact.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.canonicalLineage.upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ canonicalized: 0, skipped: 1, warnings: [] });
  });
});