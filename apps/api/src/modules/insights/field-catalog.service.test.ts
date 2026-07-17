import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  canonicalFactAttribute: { findMany: vi.fn() },
  canonicalFact: { findMany: vi.fn() }
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { getObservedFieldCatalog } from './service.js';

describe('getObservedFieldCatalog', () => {
  beforeEach(() => {
    mockPrisma.canonicalFactAttribute.findMany.mockReset();
    mockPrisma.canonicalFact.findMany.mockReset();
  });

  it('agrega campos por provider, entity_type, fact_type e atributo', async () => {
    mockPrisma.canonicalFactAttribute.findMany.mockResolvedValue([
      {
        factId: 'fact-1',
        attributeName: 'title',
        valueType: 'string',
        isMultivalue: false,
        valueString: 'Fix release flow',
        valueNumber: null,
        valueBoolean: null,
        valueDatetime: null,
        valueJson: null,
        fact: {
          provider: 'github',
          sourceEntityType: 'pull_request',
          factType: 'pull_request'
        }
      },
      {
        factId: 'fact-2',
        attributeName: 'title',
        valueType: 'string',
        isMultivalue: false,
        valueString: 'Improve release flow',
        valueNumber: null,
        valueBoolean: null,
        valueDatetime: null,
        valueJson: null,
        fact: {
          provider: 'github',
          sourceEntityType: 'pull_request',
          factType: 'pull_request'
        }
      },
      {
        factId: 'fact-2',
        attributeName: 'labels',
        valueType: 'json',
        isMultivalue: true,
        valueString: null,
        valueNumber: null,
        valueBoolean: null,
        valueDatetime: null,
        valueJson: ['ops-toil'],
        fact: {
          provider: 'github',
          sourceEntityType: 'pull_request',
          factType: 'pull_request'
        }
      }
    ] as never);
    mockPrisma.canonicalFact.findMany.mockResolvedValue([
      {
        id: 'fact-1',
        provider: 'github',
        sourceEntityType: 'pull_request',
        factType: 'pull_request'
      },
      {
        id: 'fact-2',
        provider: 'github',
        sourceEntityType: 'pull_request',
        factType: 'pull_request'
      }
    ] as never);

    const result = await getObservedFieldCatalog('ten_test', {
      provider: 'github',
      entity_type: 'pull_request',
      fact_type: 'pull_request',
      limit: 10
    });

    expect(result.tenant_id).toBe('ten_test');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      attribute_name: 'title',
      occurrence_count: 2,
      total_fact_count: 2,
      facts_with_attribute_count: 2,
      attribute_coverage_ratio: 1,
      group_coverage_ratio: 1,
      value_types: ['string'],
      example_values: ['Fix release flow', 'Improve release flow']
    });
    expect(result.items[1]).toMatchObject({
      attribute_name: 'labels',
      multivalue_count: 1,
      total_fact_count: 2,
      facts_with_attribute_count: 1,
      attribute_coverage_ratio: 0.5,
      group_coverage_ratio: 0.5,
      value_types: ['json']
    });
    expect(result.provider_summary).toHaveLength(1);
    expect(result.provider_summary[0]).toMatchObject({
      provider: 'github',
      total_fact_count: 2,
      fact_type_count: 1,
      entity_type_count: 1,
      fields_with_coverage: 2
    });
  });

  it('aplica limite do catalogo', async () => {
    mockPrisma.canonicalFactAttribute.findMany.mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => ({
        factId: `fact-${index}`,
        attributeName: `field_${index}`,
        valueType: 'string',
        isMultivalue: false,
        valueString: `value_${index}`,
        valueNumber: null,
        valueBoolean: null,
        valueDatetime: null,
        valueJson: null,
        fact: {
          provider: 'github',
          sourceEntityType: 'issue',
          factType: 'work_item'
        }
      })) as never
    );
    mockPrisma.canonicalFact.findMany.mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => ({
        id: `fact-${index}`,
        provider: 'github',
        sourceEntityType: 'issue',
        factType: 'work_item'
      })) as never
    );

    const result = await getObservedFieldCatalog('ten_test', {
      provider: 'github',
      limit: 1
    });

    expect(result.items).toHaveLength(1);
  });

  it('resume cobertura por provider em multiplas fontes', async () => {
    mockPrisma.canonicalFactAttribute.findMany.mockResolvedValue([
      {
        factId: 'fact-github-1',
        attributeName: 'title',
        valueType: 'string',
        isMultivalue: false,
        valueString: 'Fix release flow',
        valueNumber: null,
        valueBoolean: null,
        valueDatetime: null,
        valueJson: null,
        fact: { provider: 'github', sourceEntityType: 'pull_request', factType: 'pull_request' }
      },
      {
        factId: 'fact-jira-1',
        attributeName: 'summary',
        valueType: 'string',
        isMultivalue: false,
        valueString: 'Refatorar pipeline',
        valueNumber: null,
        valueBoolean: null,
        valueDatetime: null,
        valueJson: null,
        fact: { provider: 'jira', sourceEntityType: 'issue', factType: 'work_item' }
      },
      {
        factId: 'fact-incident-1',
        attributeName: 'severity',
        valueType: 'string',
        isMultivalue: false,
        valueString: 'P1',
        valueNumber: null,
        valueBoolean: null,
        valueDatetime: null,
        valueJson: null,
        fact: { provider: 'incident_io', sourceEntityType: 'incident', factType: 'incident' }
      }
    ] as never);
    mockPrisma.canonicalFact.findMany.mockResolvedValue([
      { id: 'fact-github-1', provider: 'github', sourceEntityType: 'pull_request', factType: 'pull_request' },
      { id: 'fact-jira-1', provider: 'jira', sourceEntityType: 'issue', factType: 'work_item' },
      { id: 'fact-incident-1', provider: 'incident_io', sourceEntityType: 'incident', factType: 'incident' }
    ] as never);

    const result = await getObservedFieldCatalog('ten_test', {
      limit: 10
    });

    expect(result.provider_summary).toHaveLength(3);
    expect(result.provider_summary.map((item) => item.provider)).toEqual(['github', 'incident_io', 'jira']);
    expect(result.provider_summary).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'github', total_fact_count: 1, coverage_ratio: 1 }),
      expect.objectContaining({ provider: 'jira', total_fact_count: 1, coverage_ratio: 1 }),
      expect.objectContaining({ provider: 'incident_io', total_fact_count: 1, coverage_ratio: 1 })
    ]));
  });
});
