import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  squadScope: { findMany: vi.fn() },
  metricFormula: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  classificationResult: { findMany: vi.fn() },
  metricComputationRun: { create: vi.fn(), update: vi.fn() },
  materializedInsight: { upsert: vi.fn() }
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { createNextMetricFormulaVersion, evaluateMetricFormulaBatch, getLatestMetricFormulaVersion, materializeSquadMetrics } from './metric-formula.service.js';

type FormulaBatchInput = Parameters<typeof evaluateMetricFormulaBatch>[0][number];

function makeFormula(overrides: Partial<FormulaBatchInput> = {}): FormulaBatchInput {
  return {
    key: 'toil_rate',
    name: 'Toil Rate',
    version: 1,
    unit: 'percent',
    config: {
      kind: 'ratio',
      source: 'classification_results',
      numerator: {
        kind: 'count',
        source: 'classification_results',
        filters: [
          { field: 'classifier_key', operator: 'equals', value: 'toil' },
          { field: 'classification_status', operator: 'equals', value: 'matched' }
        ]
      },
      denominator: {
        kind: 'count',
        source: 'classification_results'
      }
    },
    ...overrides
  };
}

describe('metric formula service', () => {
  beforeEach(() => {
    mockPrisma.squadScope.findMany.mockReset();
    mockPrisma.metricFormula.findFirst.mockReset();
    mockPrisma.metricFormula.findMany.mockReset();
    mockPrisma.metricFormula.create.mockReset();
    mockPrisma.classificationResult.findMany.mockReset();
    mockPrisma.metricComputationRun.create.mockReset();
    mockPrisma.metricComputationRun.update.mockReset();
    mockPrisma.materializedInsight.upsert.mockReset();
  });

  it('evaluates a batch of configurable formulas', () => {
    const rows = [
      { classifier_key: 'toil', classification_status: 'matched', classification_score: 1, fact_type: 'work_item' },
      { classifier_key: 'toil', classification_status: 'matched', classification_score: 0.5, fact_type: 'work_item' },
      { classifier_key: 'bug', classification_status: 'matched', classification_score: 0.75, fact_type: 'pull_request' }
    ];

    const results = evaluateMetricFormulaBatch(
      [
        makeFormula(),
        {
          key: 'average_score',
          name: 'Average Score',
          unit: 'score',
          version: 1,
          config: {
            kind: 'average',
            source: 'classification_results',
            field: 'classification_score'
          }
        },
        {
          key: 'work_item_volume',
          name: 'Work Item Volume',
          unit: 'count',
          version: 1,
          config: {
            kind: 'count',
            source: 'classification_results',
            filters: [{ field: 'fact_type', operator: 'equals', value: 'work_item' }]
          }
        }
      ],
      rows
    );

    expect(results).toEqual([
      expect.objectContaining({ key: 'toil_rate', value: 0.6667 }),
      expect.objectContaining({ key: 'average_score', value: 0.75 }),
      expect.objectContaining({ key: 'work_item_volume', value: 2 })
    ]);
  });

  it('returns the latest formula version for a squad and key', async () => {
    mockPrisma.metricFormula.findFirst.mockResolvedValueOnce({ version: 5 });

    const result = await getLatestMetricFormulaVersion('ten_test', 'squad-1', 'toil_rate');

    expect(result?.version).toBe(5);
  });

  it('creates the next formula version incrementally', async () => {
    mockPrisma.metricFormula.findFirst.mockResolvedValueOnce({ version: 2 });
    mockPrisma.metricFormula.create.mockResolvedValueOnce({ id: 'formula-2', version: 3 });

    const result = await createNextMetricFormulaVersion({
      tenantId: 'ten_test',
      squadId: 'squad-1',
      key: 'toil_rate',
      name: 'Toil Rate',
      unit: 'percent',
      windowDays: 14,
      config: {
        kind: 'ratio',
        source: 'classification_results',
        numerator: { kind: 'count', source: 'classification_results' },
        denominator: { kind: 'count', source: 'classification_results' }
      },
      createdBy: 'user-1',
      updatedBy: 'user-1'
    });

    expect(mockPrisma.metricFormula.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: 'toil_rate',
          version: 3,
          windowDays: 14,
          status: 'draft'
        })
      })
    );
    expect(result.version).toBe(3);
  });

  it('materializes formula metrics for a squad and window', async () => {
    mockPrisma.metricFormula.findMany.mockResolvedValueOnce([
      {
        id: 'formula-1',
        tenantId: 'ten_test',
        squadId: 'squad-1',
        key: 'toil_rate',
        name: 'Toil Rate',
        description: null,
        status: 'active',
        version: 1,
        unit: 'percent',
        windowDays: 30,
        config: makeFormula().config
      },
      {
        id: 'formula-2',
        tenantId: 'ten_test',
        squadId: 'squad-1',
        key: 'average_score',
        name: 'Average Score',
        description: null,
        status: 'active',
        version: 1,
        unit: 'score',
        windowDays: 30,
        config: {
          kind: 'average',
          source: 'classification_results',
          field: 'classification_score'
        }
      }
    ]);
    mockPrisma.squadScope.findMany.mockResolvedValueOnce([
      { id: 'scope-1', name: 'Primary scope', version: 1, status: 'active', config: { providers: ['jira'], entity_types: ['issue'], fact_types: ['work_item'] } }
    ]);
    mockPrisma.classificationResult.findMany.mockResolvedValueOnce([
      {
        id: 'result-1',
        status: 'matched',
        score: 1,
        payload: { classifier_key: 'toil', classifier_version: 1, reasons: ['classifier_match'], payload: {} },
        classifiedAt: new Date('2026-07-17T10:00:00.000Z'),
        canonicalFact: {
          id: 'fact-1',
          factType: 'work_item',
          provider: 'jira',
          sourceEntityType: 'issue',
          payload: { summary: 'Fix login' },
          attributes: []
        }
      },
      {
        id: 'result-2',
        status: 'matched',
        score: 0.5,
        payload: { classifier_key: 'bug', classifier_version: 1, reasons: ['classifier_match'], payload: {} },
        classifiedAt: new Date('2026-07-17T11:00:00.000Z'),
        canonicalFact: {
          id: 'fact-2',
          factType: 'pull_request',
          provider: 'github',
          sourceEntityType: 'pull_request',
          payload: { title: 'Add webhook support' },
          attributes: []
        }
      }
    ]);
    mockPrisma.metricComputationRun.create.mockResolvedValueOnce({ id: 'run-1' });
    mockPrisma.materializedInsight.upsert
      .mockResolvedValueOnce({ id: 'insight-1' })
      .mockResolvedValueOnce({ id: 'insight-2' });
    mockPrisma.metricComputationRun.update.mockResolvedValueOnce({ id: 'run-1' });

    const result = await materializeSquadMetrics({
      tenantId: 'ten_test',
      squadId: 'squad-1',
      windowStart: new Date('2026-07-17T00:00:00.000Z'),
      windowEnd: new Date('2026-07-18T00:00:00.000Z'),
      triggeredBy: 'user-1'
    });

    expect(result).toEqual({
      run_id: 'run-1',
      status: 'success',
      materialized_count: 2,
      metric_keys: ['toil_rate', 'average_score']
    });
    expect(mockPrisma.materializedInsight.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.metricComputationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({ status: 'success' })
      })
    );
  });
});