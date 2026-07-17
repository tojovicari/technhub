import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  classificationResult: { upsert: vi.fn() },
  squadClassifier: { findFirst: vi.fn(), create: vi.fn() }
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { classifyAndPersistCanonicalFact, classifyCanonicalFact, createNextSquadClassifierVersion, evaluateSquadClassifier, evaluateSquadScope, getLatestSquadClassifierVersion, persistClassificationResult } from './squad-classification.service.js';

const toilFact = {
  provider: 'jira',
  sourceEntityType: 'issue',
  factType: 'work_item',
  payload: {
    issue_type: 'Support',
    labels: ['ops-toil', 'backend'],
    title: 'Triar fila'
  },
  attributes: [
    { attributeName: 'issue_type', valueString: 'Support' },
    { attributeName: 'labels', valueJson: ['ops-toil', 'backend'] }
  ]
} satisfies Parameters<typeof evaluateSquadScope>[0];

describe('squad classification service', () => {
  beforeEach(() => {
    mockPrisma.classificationResult.upsert.mockReset();
    mockPrisma.squadClassifier.findFirst.mockReset();
    mockPrisma.squadClassifier.create.mockReset();
  });

  it('matches squad scope with provider, entity and required attributes', () => {
    const result = evaluateSquadScope(toilFact, {
      providers: ['jira'],
      entity_types: ['issue'],
      fact_types: ['work_item'],
      required_attributes: ['issue_type', 'labels']
    });

    expect(result.matches).toBe(true);
    expect(result.reasons).toContain('scope_match');
  });

  it('evaluates a declarative toil classifier', () => {
    const result = evaluateSquadClassifier(toilFact, {
      key: 'toil',
      version: 1,
      applies_to: ['work_item'],
      rule: {
        any: [
          { field: 'issue_type', operator: 'equals', value: 'Support' },
          { field: 'labels', operator: 'contains', value: 'ops-toil' }
        ]
      }
    });

    expect(result.matches).toBe(true);
    expect(result.score).toBe(1);
  });

  it('skips classification when scope does not match', () => {
    const result = classifyCanonicalFact(
      toilFact,
      {
        providers: ['github'],
        entity_types: ['pull_request'],
        fact_types: ['pull_request']
      },
      {
        key: 'toil',
        version: 1,
        applies_to: ['work_item'],
        rule: { any: [{ field: 'issue_type', operator: 'equals', value: 'Support' }] }
      }
    );

    expect(result.status).toBe('skipped');
    expect(result.reasons).toContain('provider_not_in_scope');
  });

  it('persists classification results idempotently by result key', async () => {
    mockPrisma.classificationResult.upsert.mockResolvedValueOnce({ id: 'result-1' });

    await persistClassificationResult({
      tenantId: 'ten_test',
      squadId: 'squad-1',
      canonicalFactId: 'fact-1',
      classifier: { id: 'classifier-1', key: 'toil', version: 1 },
      evaluation: { matches: true, reasons: ['classifier_match'], score: 1 },
      payload: { issue_type: 'Support' }
    });

    const call = mockPrisma.classificationResult.upsert.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };

    expect(call.where).toEqual({
      tenantId_squadId_canonicalFactId_resultKey: {
        tenantId: 'ten_test',
        squadId: 'squad-1',
        canonicalFactId: 'fact-1',
        resultKey: 'toil::v1'
      }
    });
    expect(call.create.resultKey).toBe('toil::v1');
    expect(call.create.status).toBe('matched');
    expect(call.update.status).toBe('matched');
  });

  it('classifies and persists the same fact in one pass', async () => {
    mockPrisma.classificationResult.upsert.mockResolvedValueOnce({ id: 'result-2' });

    const result = await classifyAndPersistCanonicalFact({
      tenantId: 'ten_test',
      squadId: 'squad-1',
      canonicalFactId: 'fact-1',
      fact: toilFact,
      scope: {
        providers: ['jira'],
        entity_types: ['issue'],
        fact_types: ['work_item']
      },
      classifier: {
        id: 'classifier-1',
        key: 'toil',
        version: 1,
        applies_to: ['work_item'],
        rule: {
          any: [
            { field: 'issue_type', operator: 'equals', value: 'Support' }
          ]
        }
      }
    });

    expect(result.classification.status).toBe('matched');
    expect(result.result.id).toBe('result-2');
  });

  it('returns the latest classifier version for a squad and key', async () => {
    mockPrisma.squadClassifier.findFirst.mockResolvedValueOnce({
      id: 'classifier-2',
      tenantId: 'ten_test',
      squadId: 'squad-1',
      key: 'toil',
      version: 3,
      appliesToFactType: 'work_item',
      status: 'active',
      config: {},
      createdBy: null,
      updatedBy: null
    });

    const result = await getLatestSquadClassifierVersion('ten_test', 'squad-1', 'toil');

    expect(result?.version).toBe(3);
  });

  it('creates the next classifier version incrementally', async () => {
    mockPrisma.squadClassifier.findFirst.mockResolvedValueOnce({
      id: 'classifier-2',
      tenantId: 'ten_test',
      squadId: 'squad-1',
      key: 'toil',
      version: 3,
      appliesToFactType: 'work_item',
      status: 'active',
      config: {},
      createdBy: null,
      updatedBy: null
    });
    mockPrisma.squadClassifier.create.mockResolvedValueOnce({
      id: 'classifier-3',
      tenantId: 'ten_test',
      squadId: 'squad-1',
      key: 'toil',
      version: 4,
      appliesToFactType: 'work_item',
      status: 'draft',
      config: {},
      createdBy: 'user-1',
      updatedBy: 'user-1'
    });

    const result = await createNextSquadClassifierVersion({
      tenantId: 'ten_test',
      squadId: 'squad-1',
      key: 'toil',
      appliesToFactType: 'work_item',
      config: { rule: { any: [{ field: 'labels', operator: 'contains', value: 'ops-toil' }] } },
      createdBy: 'user-1',
      updatedBy: 'user-1'
    });

    expect(mockPrisma.squadClassifier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 4,
          key: 'toil',
          appliesToFactType: 'work_item',
          status: 'draft'
        })
      })
    );
    expect(result.version).toBe(4);
  });
});