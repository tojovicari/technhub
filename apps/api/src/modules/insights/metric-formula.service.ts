import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { evaluateSquadScope } from './squad-classification.service.js';

type MetricFilterOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte';

export type MetricFormulaFilter = {
  field: string;
  operator?: MetricFilterOperator;
  value?: unknown;
};

export type MetricFormulaConfig = {
  kind: 'count' | 'sum' | 'average' | 'ratio' | 'difference';
  source: 'classification_results';
  field?: string;
  filters?: MetricFormulaFilter[];
  numerator?: MetricFormulaConfig;
  denominator?: MetricFormulaConfig;
  left?: MetricFormulaConfig;
  right?: MetricFormulaConfig;
};

type MetricRow = Record<string, unknown>;

type ClassificationResultWithFact = {
  id: string;
  status: string;
  score: number | null;
  payload: unknown;
  classifiedAt: Date;
  canonicalFact: {
    id: string;
    factType: string;
    provider: string;
    sourceEntityType: string;
    payload: unknown;
    attributes: Array<{
      attributeName: string;
      valueString: string | null;
      valueNumber: number | null;
      valueBoolean: boolean | null;
      valueDatetime: Date | null;
      valueJson: Prisma.JsonValue | null;
    }>;
  };
};

type MetricFormulaRecord = {
  id: string;
  tenantId: string;
  squadId: string;
  key: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  version: number;
  unit: string;
  windowDays: number;
  config: Prisma.JsonValue;
};

type MetricComputationInput = {
  tenantId: string;
  squadId: string;
  windowStart: Date;
  windowEnd: Date;
  triggeredBy?: string | null;
  triggerReason?: string | null;
};

type FormulaListInput = {
  tenantId: string;
  squadId: string;
  status?: 'draft' | 'active' | 'archived';
  key?: string;
  limit?: number;
};

type MetricEvaluationResult = {
  value: number;
  explanation: Record<string, unknown>;
};

function toLowerString(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function asArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function getFieldValue(row: MetricRow, field: string) {
  return field.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, row);
}

function matchesFilter(row: MetricRow, filter: MetricFormulaFilter): boolean {
  const actual = getFieldValue(row, filter.field);
  const expected = filter.value;
  const operator = filter.operator ?? 'equals';

  switch (operator) {
    case 'equals':
      return actual === expected || toLowerString(actual) === toLowerString(expected);
    case 'not_equals':
      return !(actual === expected || toLowerString(actual) === toLowerString(expected));
    case 'contains':
      return asArray(actual).some((item) => item === expected || toLowerString(item) === toLowerString(expected))
        || toLowerString(actual).includes(toLowerString(expected));
    case 'not_contains':
      return !matchesFilter(row, { ...filter, operator: 'contains' });
    case 'in':
      return asArray(expected).some((item) => item === actual || toLowerString(item) === toLowerString(actual));
    case 'not_in':
      return !matchesFilter(row, { ...filter, operator: 'in' });
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    default:
      return false;
  }
}

function filterRows(rows: MetricRow[], filters: MetricFormulaFilter[] | undefined) {
  if (!filters?.length) return rows;
  return rows.filter((row) => filters.every((filter) => matchesFilter(row, filter)));
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function normalizeClassificationRows(rows: ClassificationResultWithFact[]): MetricRow[] {
  return rows.map((row) => {
    const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {};
    const classifierPayload = payload.payload && typeof payload.payload === 'object' ? (payload.payload as Record<string, unknown>) : {};

    return {
      classification_id: row.id,
      classification_status: row.status,
      classification_score: row.score,
      classifier_key: typeof payload.classifier_key === 'string' ? payload.classifier_key : null,
      classifier_version: typeof payload.classifier_version === 'number' ? payload.classifier_version : null,
      classification_reasons: Array.isArray(payload.reasons) ? payload.reasons : [],
      classified_at: row.classifiedAt,
      fact_id: row.canonicalFact.id,
      fact_type: row.canonicalFact.factType,
      fact_provider: row.canonicalFact.provider,
      fact_source_entity_type: row.canonicalFact.sourceEntityType,
      fact_payload: row.canonicalFact.payload,
      fact_attributes: row.canonicalFact.attributes,
      payload: classifierPayload
    };
  });
}

function evaluateMetricFormula(config: MetricFormulaConfig, rows: MetricRow[]): MetricEvaluationResult {
  const scopedRows = filterRows(rows, config.filters);

  switch (config.kind) {
    case 'count':
      return {
        value: scopedRows.length,
        explanation: {
          kind: config.kind,
          source: config.source,
          filters: config.filters ?? [],
          matched_rows: scopedRows.length
        }
      };
    case 'sum': {
      const values = scopedRows
        .map((row) => Number(getFieldValue(row, config.field ?? '')))
        .filter((value) => Number.isFinite(value));
      const total = values.reduce((sum, value) => sum + value, 0);
      return {
        value: round4(total),
        explanation: {
          kind: config.kind,
          source: config.source,
          field: config.field,
          filters: config.filters ?? [],
          matched_rows: scopedRows.length,
          contributing_values: values
        }
      };
    }
    case 'average': {
      const values = scopedRows
        .map((row) => Number(getFieldValue(row, config.field ?? '')))
        .filter((value) => Number.isFinite(value));
      const average = values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
      return {
        value: round4(average),
        explanation: {
          kind: config.kind,
          source: config.source,
          field: config.field,
          filters: config.filters ?? [],
          matched_rows: scopedRows.length,
          contributing_values: values
        }
      };
    }
    case 'ratio': {
      const numerator = config.numerator ? evaluateMetricFormula(config.numerator, rows) : { value: 0, explanation: { kind: 'count' } };
      const denominator = config.denominator ? evaluateMetricFormula(config.denominator, rows) : { value: 0, explanation: { kind: 'count' } };
      const value = denominator.value === 0 ? 0 : numerator.value / denominator.value;

      return {
        value: round4(value),
        explanation: {
          kind: config.kind,
          source: config.source,
          numerator: numerator.explanation,
          denominator: denominator.explanation,
          numerator_value: numerator.value,
          denominator_value: denominator.value
        }
      };
    }
    case 'difference': {
      const left = config.left ? evaluateMetricFormula(config.left, rows) : { value: 0, explanation: { kind: 'count' } };
      const right = config.right ? evaluateMetricFormula(config.right, rows) : { value: 0, explanation: { kind: 'count' } };

      return {
        value: round4(left.value - right.value),
        explanation: {
          kind: config.kind,
          source: config.source,
          left: left.explanation,
          right: right.explanation,
          left_value: left.value,
          right_value: right.value
        }
      };
    }
    default:
      return {
        value: 0,
        explanation: {
          kind: 'count',
          source: config.source,
          filters: config.filters ?? [],
          matched_rows: 0
        }
      };
  }
}

export function evaluateMetricFormulaBatch(formulas: Array<{ key: string; name: string; unit: string; version: number; config: MetricFormulaConfig }>, rows: MetricRow[]) {
  return formulas.map((formula) => {
    const evaluation = evaluateMetricFormula(formula.config, rows);
    return {
      key: formula.key,
      name: formula.name,
      unit: formula.unit,
      version: formula.version,
      value: evaluation.value,
      explanation: evaluation.explanation
    };
  });
}

export async function getLatestMetricFormulaVersion(tenantId: string, squadId: string, key: string) {
  return prisma.metricFormula.findFirst({
    where: { tenantId, squadId, key },
    orderBy: { version: 'desc' }
  });
}

export async function createNextMetricFormulaVersion(input: {
  tenantId: string;
  squadId: string;
  key: string;
  name: string;
  description?: string | null;
  unit: string;
  windowDays?: number;
  config: Prisma.InputJsonValue;
  createdBy?: string | null;
  updatedBy?: string | null;
  status?: 'draft' | 'active' | 'archived';
}) {
  const latest = await getLatestMetricFormulaVersion(input.tenantId, input.squadId, input.key);
  const nextVersion = (latest?.version ?? 0) + 1;

  return prisma.metricFormula.create({
    data: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      unit: input.unit,
      windowDays: input.windowDays ?? 30,
      version: nextVersion,
      status: input.status ?? 'draft',
      config: input.config,
      createdBy: input.createdBy ?? null,
      updatedBy: input.updatedBy ?? null
    }
  });
}

async function getActiveSquadScopes(tenantId: string, squadId: string) {
  return prisma.squadScope.findMany({
    where: {
      tenantId,
      squadId,
      status: 'active'
    },
    orderBy: { version: 'desc' }
  });
}

async function getActiveMetricFormulas(tenantId: string, squadId: string) {
  return prisma.metricFormula.findMany({
    where: {
      tenantId,
      squadId,
      status: 'active'
    },
    orderBy: [
      { key: 'asc' },
      { version: 'desc' }
    ]
  }) as Promise<MetricFormulaRecord[]>;
}

async function getScopedClassificationRows(input: MetricComputationInput) {
  const scopes = await getActiveSquadScopes(input.tenantId, input.squadId);

  const rows = await prisma.classificationResult.findMany({
    where: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      classifiedAt: {
        gte: input.windowStart,
        lte: input.windowEnd
      }
    },
    select: {
      id: true,
      status: true,
      score: true,
      payload: true,
      classifiedAt: true,
      canonicalFact: {
        select: {
          id: true,
          factType: true,
          provider: true,
          sourceEntityType: true,
          payload: true,
          attributes: {
            select: {
              attributeName: true,
              valueString: true,
              valueNumber: true,
              valueBoolean: true,
              valueDatetime: true,
              valueJson: true
            }
          }
        }
      }
    }
  }) as ClassificationResultWithFact[];

  const filteredRows = scopes.length === 0
    ? rows
    : rows.filter((row) => scopes.some((scope) => evaluateSquadScope({
      provider: row.canonicalFact.provider,
      sourceEntityType: row.canonicalFact.sourceEntityType,
      factType: row.canonicalFact.factType,
      payload: row.canonicalFact.payload as Record<string, unknown>,
      attributes: row.canonicalFact.attributes.map((attribute) => ({
        attributeName: attribute.attributeName,
        valueString: attribute.valueString,
        valueNumber: attribute.valueNumber,
        valueBoolean: attribute.valueBoolean,
        valueDatetime: attribute.valueDatetime,
        valueJson: attribute.valueJson
      }))
    }, scope.config as Parameters<typeof evaluateSquadScope>[1]).matches));

  return {
    scopes,
    rows: normalizeClassificationRows(filteredRows)
  };
}

export async function materializeSquadMetrics(input: MetricComputationInput) {
  const formulas = await getActiveMetricFormulas(input.tenantId, input.squadId);
  const { scopes, rows } = await getScopedClassificationRows(input);

  const run = await prisma.metricComputationRun.create({
    data: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      status: 'running',
      triggeredBy: input.triggeredBy ?? null,
      triggerReason: input.triggerReason ?? null,
      startedAt: new Date(),
      inputSummary: {
        scopes: scopes.map((scope) => ({
          id: scope.id,
          name: scope.name,
          version: scope.version,
          status: scope.status
        })),
        formula_count: formulas.length,
        row_count: rows.length
      } as Prisma.InputJsonValue
    }
  });

  const computedAt = new Date();

  try {
    const materializations = evaluateMetricFormulaBatch(
      formulas.map((formula) => ({
        key: formula.key,
        name: formula.name,
        unit: formula.unit,
        version: formula.version,
        config: formula.config as MetricFormulaConfig
      })),
      rows
    );

    await Promise.all(
      materializations.map((materialization, index) =>
        prisma.materializedInsight.upsert({
          where: {
            tenantId_squadId_formulaId_windowStart_windowEnd: {
              tenantId: input.tenantId,
              squadId: input.squadId,
              formulaId: formulas[index].id,
              windowStart: input.windowStart,
              windowEnd: input.windowEnd
            }
          },
          create: {
            tenantId: input.tenantId,
            squadId: input.squadId,
            formulaId: formulas[index].id,
            runId: run.id,
            metricKey: materialization.key,
            metricName: materialization.name,
            formulaVersion: materialization.version,
            windowStart: input.windowStart,
            windowEnd: input.windowEnd,
            value: materialization.value,
            unit: materialization.unit,
            explanation: materialization.explanation as Prisma.InputJsonValue,
            sourceSummary: {
              row_count: rows.length,
              formula_key: materialization.key
            } as Prisma.InputJsonValue,
            computedAt
          },
          update: {
            runId: run.id,
            metricKey: materialization.key,
            metricName: materialization.name,
            formulaVersion: materialization.version,
            value: materialization.value,
            unit: materialization.unit,
            explanation: materialization.explanation as Prisma.InputJsonValue,
            sourceSummary: {
              row_count: rows.length,
              formula_key: materialization.key
            } as Prisma.InputJsonValue,
            computedAt
          }
        })
      )
    );

    await prisma.metricComputationRun.update({
      where: { id: run.id },
      data: {
        status: 'success',
        finishedAt: new Date(),
        resultSummary: {
          formula_count: materializations.length,
          metric_keys: materializations.map((materialization) => materialization.key),
          row_count: rows.length
        } as Prisma.InputJsonValue
      }
    });

    return {
      run_id: run.id,
      status: 'success' as const,
      materialized_count: materializations.length,
      metric_keys: materializations.map((materialization) => materialization.key)
    };
  } catch (error) {
    await prisma.metricComputationRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorSummary: error instanceof Error ? error.message : 'metric_materialization_failed'
      }
    });

    throw error;
  }
}

async function squadExists(tenantId: string, squadId: string) {
  const squad = await prisma.squad.findFirst({
    where: { tenantId, id: squadId },
    select: { id: true, key: true, name: true }
  });

  return squad;
}

export async function listMetricFormulasForSquad(input: FormulaListInput) {
  const squad = await squadExists(input.tenantId, input.squadId);
  if (!squad) return null;

  const items = await prisma.metricFormula.findMany({
    where: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.key ? { key: input.key } : {})
    },
    orderBy: [
      { key: 'asc' },
      { version: 'desc' }
    ],
    take: input.limit ?? 50
  });

  return {
    squad: {
      id: squad.id,
      key: squad.key,
      name: squad.name
    },
    items: items.map((item) => ({
      id: item.id,
      key: item.key,
      name: item.name,
      description: item.description,
      status: item.status,
      version: item.version,
      unit: item.unit,
      window_days: item.windowDays,
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString(),
      config: item.config
    }))
  };
}

export async function createDraftMetricFormula(input: {
  tenantId: string;
  squadId: string;
  userId?: string | null;
  key: string;
  name: string;
  description?: string | null;
  unit: string;
  windowDays?: number;
  config: Prisma.InputJsonValue;
}) {
  const squad = await squadExists(input.tenantId, input.squadId);
  if (!squad) return null;

  const formula = await createNextMetricFormulaVersion({
    tenantId: input.tenantId,
    squadId: input.squadId,
    key: input.key,
    name: input.name,
    description: input.description,
    unit: input.unit,
    windowDays: input.windowDays,
    config: input.config,
    createdBy: input.userId ?? null,
    updatedBy: input.userId ?? null,
    status: 'draft'
  });

  return {
    id: formula.id,
    squad_id: formula.squadId,
    key: formula.key,
    name: formula.name,
    description: formula.description,
    status: formula.status,
    version: formula.version,
    unit: formula.unit,
    window_days: formula.windowDays,
    created_at: formula.createdAt.toISOString(),
    updated_at: formula.updatedAt.toISOString(),
    config: formula.config
  };
}

export async function publishMetricFormula(input: {
  tenantId: string;
  squadId: string;
  formulaId: string;
  userId?: string | null;
}) {
  const squad = await squadExists(input.tenantId, input.squadId);
  if (!squad) return null;

  const target = await prisma.metricFormula.findFirst({
    where: {
      id: input.formulaId,
      tenantId: input.tenantId,
      squadId: input.squadId
    }
  });

  if (!target) return null;

  await prisma.metricFormula.updateMany({
    where: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      key: target.key,
      status: 'active'
    },
    data: {
      status: 'archived',
      updatedBy: input.userId ?? null
    }
  });

  const published = await prisma.metricFormula.update({
    where: { id: target.id },
    data: {
      status: 'active',
      updatedBy: input.userId ?? null
    }
  });

  return {
    id: published.id,
    squad_id: published.squadId,
    key: published.key,
    name: published.name,
    status: published.status,
    version: published.version,
    unit: published.unit,
    window_days: published.windowDays,
    updated_at: published.updatedAt.toISOString()
  };
}

export async function simulateMetricFormula(input: {
  tenantId: string;
  squadId: string;
  formula: {
    key: string;
    name: string;
    unit: string;
    version?: number;
    config: MetricFormulaConfig;
  };
  windowStart: Date;
  windowEnd: Date;
}) {
  const squad = await squadExists(input.tenantId, input.squadId);
  if (!squad) return null;

  const { rows } = await getScopedClassificationRows({
    tenantId: input.tenantId,
    squadId: input.squadId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd
  });

  const [result] = evaluateMetricFormulaBatch([
    {
      key: input.formula.key,
      name: input.formula.name,
      unit: input.formula.unit,
      version: input.formula.version ?? 1,
      config: input.formula.config
    }
  ], rows);

  return {
    squad_id: input.squadId,
    window_start: input.windowStart.toISOString(),
    window_end: input.windowEnd.toISOString(),
    sample_row_count: rows.length,
    result
  };
}

export async function listMaterializedInsightsForSquad(input: {
  tenantId: string;
  squadId: string;
  metricKey?: string;
  windowStart?: Date;
  windowEnd?: Date;
  limit?: number;
}) {
  const squad = await squadExists(input.tenantId, input.squadId);
  if (!squad) return null;

  const items = await prisma.materializedInsight.findMany({
    where: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      ...(input.metricKey ? { metricKey: input.metricKey } : {}),
      ...(input.windowStart || input.windowEnd
        ? {
            windowStart: {
              ...(input.windowStart ? { gte: input.windowStart } : {})
            },
            windowEnd: {
              ...(input.windowEnd ? { lte: input.windowEnd } : {})
            }
          }
        : {})
    },
    orderBy: [
      { computedAt: 'desc' }
    ],
    take: input.limit ?? 50
  });

  return {
    squad: {
      id: squad.id,
      key: squad.key,
      name: squad.name
    },
    items: items.map((item) => ({
      id: item.id,
      metric_key: item.metricKey,
      metric_name: item.metricName,
      formula_id: item.formulaId,
      formula_version: item.formulaVersion,
      value: item.value,
      unit: item.unit,
      window_start: item.windowStart.toISOString(),
      window_end: item.windowEnd.toISOString(),
      computed_at: item.computedAt.toISOString()
    }))
  };
}

export async function getMaterializedInsightExplainability(input: {
  tenantId: string;
  squadId: string;
  insightId: string;
}) {
  const insight = await prisma.materializedInsight.findFirst({
    where: {
      id: input.insightId,
      tenantId: input.tenantId,
      squadId: input.squadId
    },
    include: {
      formula: {
        select: {
          id: true,
          key: true,
          name: true,
          version: true,
          config: true
        }
      },
      run: {
        select: {
          id: true,
          status: true,
          windowStart: true,
          windowEnd: true,
          triggerReason: true,
          inputSummary: true,
          resultSummary: true,
          startedAt: true,
          finishedAt: true
        }
      }
    }
  });

  if (!insight) return null;

  return {
    id: insight.id,
    squad_id: insight.squadId,
    metric_key: insight.metricKey,
    metric_name: insight.metricName,
    formula: {
      id: insight.formula.id,
      key: insight.formula.key,
      name: insight.formula.name,
      version: insight.formula.version,
      config: insight.formula.config
    },
    value: insight.value,
    unit: insight.unit,
    window_start: insight.windowStart.toISOString(),
    window_end: insight.windowEnd.toISOString(),
    computed_at: insight.computedAt.toISOString(),
    explanation: insight.explanation,
    source_summary: insight.sourceSummary,
    run: insight.run
      ? {
          id: insight.run.id,
          status: insight.run.status,
          window_start: insight.run.windowStart.toISOString(),
          window_end: insight.run.windowEnd.toISOString(),
          trigger_reason: insight.run.triggerReason,
          started_at: insight.run.startedAt?.toISOString() ?? null,
          finished_at: insight.run.finishedAt?.toISOString() ?? null,
          input_summary: insight.run.inputSummary,
          result_summary: insight.run.resultSummary
        }
      : null
  };
}

export async function recomputeSquadMetrics(input: {
  tenantId: string;
  squadId: string;
  windowDays: number;
  triggerReason?: string | null;
  triggeredBy?: string | null;
}) {
  const squad = await squadExists(input.tenantId, input.squadId);
  if (!squad) return null;

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - input.windowDays * 24 * 60 * 60 * 1000);

  const result = await materializeSquadMetrics({
    tenantId: input.tenantId,
    squadId: input.squadId,
    windowStart,
    windowEnd,
    triggeredBy: input.triggeredBy,
    triggerReason: input.triggerReason
  });

  return {
    squad_id: input.squadId,
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    ...result
  };
}

export async function getMetricComputationRun(input: {
  tenantId: string;
  squadId: string;
  runId: string;
}) {
  const run = await prisma.metricComputationRun.findFirst({
    where: {
      id: input.runId,
      tenantId: input.tenantId,
      squadId: input.squadId
    }
  });

  if (!run) return null;

  return {
    id: run.id,
    squad_id: run.squadId,
    status: run.status,
    window_start: run.windowStart.toISOString(),
    window_end: run.windowEnd.toISOString(),
    trigger_reason: run.triggerReason,
    started_at: run.startedAt?.toISOString() ?? null,
    finished_at: run.finishedAt?.toISOString() ?? null,
    input_summary: run.inputSummary,
    result_summary: run.resultSummary,
    error_summary: run.errorSummary
  };
}