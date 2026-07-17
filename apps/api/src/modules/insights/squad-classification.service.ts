import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

type FactAttribute = {
  attributeName: string;
  valueString?: string | null;
  valueNumber?: number | null;
  valueBoolean?: boolean | null;
  valueDatetime?: Date | null;
  valueJson?: unknown;
};

type CanonicalFactLike = {
  provider: string;
  sourceEntityType: string;
  factType: string;
  payload: Record<string, unknown>;
  attributes?: ReadonlyArray<FactAttribute>;
};

type SquadScopeDefinition = {
  providers?: string[];
  entity_types?: string[];
  fact_types?: string[];
  required_attributes?: string[];
  excluded_attributes?: string[];
};

type ScopeEvaluation = {
  matches: boolean;
  reasons: string[];
};

type ClassifierCondition = {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte';
  value: unknown;
};

type SquadClassifierDefinition = {
  key: string;
  version: number;
  applies_to?: string[];
  rule: {
    any?: ClassifierCondition[];
    all?: ClassifierCondition[];
    not?: ClassifierCondition;
  };
};

type ClassificationEvaluation = {
  matches: boolean;
  reasons: string[];
  score: number;
};

type PersistClassificationResultInput = {
  tenantId: string;
  squadId: string;
  canonicalFactId: string;
  classifier: {
    id?: string | null;
    key: string;
    version: number;
  };
  evaluation: ClassificationEvaluation;
  payload: Record<string, unknown>;
  explanation?: Record<string, unknown>;
};

type CreateSquadClassifierVersionInput = {
  tenantId: string;
  squadId: string;
  key: string;
  appliesToFactType: string;
  config: Prisma.InputJsonValue;
  createdBy?: string | null;
  updatedBy?: string | null;
  status?: 'draft' | 'active' | 'archived';
};

type CreateSquadScopeVersionInput = {
  tenantId: string;
  squadId: string;
  name: string;
  config: Prisma.InputJsonValue;
  createdBy?: string | null;
  updatedBy?: string | null;
  status?: 'draft' | 'active' | 'archived';
};

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function toArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function resolveAttributeValue(fact: CanonicalFactLike, field: string) {
  const payloadValue = (fact.payload as Record<string, unknown>)[field];
  if (payloadValue !== undefined) return payloadValue;

  const attribute = fact.attributes?.find((item) => item.attributeName === field);
  if (!attribute) return undefined;

  return attribute.valueString ?? attribute.valueNumber ?? attribute.valueBoolean ?? attribute.valueDatetime ?? attribute.valueJson ?? undefined;
}

function compareConditionValue(actual: unknown, condition: ClassifierCondition): boolean {
  const expected = condition.value;

  switch (condition.operator) {
    case 'equals':
      return normalizeString(actual) === normalizeString(expected) || actual === expected;
    case 'not_equals':
      return !(normalizeString(actual) === normalizeString(expected) || actual === expected);
    case 'contains':
      return toArray(actual).some((item) => normalizeString(item) === normalizeString(expected) || item === expected) || normalizeString(actual).includes(normalizeString(expected));
    case 'not_contains':
      return !compareConditionValue(actual, { ...condition, operator: 'contains' });
    case 'in':
      return toArray(expected).some((item) => normalizeString(actual) === normalizeString(item) || actual === item);
    case 'not_in':
      return !compareConditionValue(actual, { ...condition, operator: 'in' });
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

export function evaluateSquadScope(fact: CanonicalFactLike, scope: SquadScopeDefinition): ScopeEvaluation {
  const reasons: string[] = [];

  if (scope.providers?.length && !scope.providers.includes(fact.provider)) {
    return { matches: false, reasons: ['provider_not_in_scope'] };
  }

  if (scope.entity_types?.length && !scope.entity_types.includes(fact.sourceEntityType)) {
    return { matches: false, reasons: ['entity_type_not_in_scope'] };
  }

  if (scope.fact_types?.length && !scope.fact_types.includes(fact.factType)) {
    return { matches: false, reasons: ['fact_type_not_in_scope'] };
  }

  if (scope.required_attributes?.length) {
    const missing = scope.required_attributes.filter((attributeName) => resolveAttributeValue(fact, attributeName) === undefined);
    if (missing.length > 0) {
      return { matches: false, reasons: missing.map((attributeName) => `missing_attribute:${attributeName}`) };
    }
  }

  if (scope.excluded_attributes?.length) {
    const excluded = scope.excluded_attributes.filter((attributeName) => resolveAttributeValue(fact, attributeName) !== undefined);
    if (excluded.length > 0) {
      return { matches: false, reasons: excluded.map((attributeName) => `excluded_attribute:${attributeName}`) };
    }
  }

  reasons.push('scope_match');
  return { matches: true, reasons };
}

export function evaluateSquadClassifier(fact: CanonicalFactLike, classifier: SquadClassifierDefinition): ClassificationEvaluation {
  if (classifier.applies_to?.length && !classifier.applies_to.includes(fact.factType)) {
    return { matches: false, reasons: ['applies_to_mismatch'], score: 0 };
  }

  const matchedAny = classifier.rule.any?.some((condition) => compareConditionValue(resolveAttributeValue(fact, condition.field), condition)) ?? false;
  const matchedAll = classifier.rule.all?.every((condition) => compareConditionValue(resolveAttributeValue(fact, condition.field), condition)) ?? true;
  const matchedNot = classifier.rule.not ? !compareConditionValue(resolveAttributeValue(fact, classifier.rule.not.field), classifier.rule.not) : true;

  const matched = (classifier.rule.any ? matchedAny : true) && matchedAll && matchedNot;

  return {
    matches: matched,
    reasons: matched ? ['classifier_match'] : ['classifier_rule_mismatch'],
    score: matched ? 1 : 0
  };
}

export function classifyCanonicalFact(
  fact: CanonicalFactLike,
  scope: SquadScopeDefinition,
  classifier: SquadClassifierDefinition
) {
  const scopeResult = evaluateSquadScope(fact, scope);
  if (!scopeResult.matches) {
    return {
      status: 'skipped' as const,
      score: 0,
      reasons: scopeResult.reasons,
      classifier_key: classifier.key,
      classifier_version: classifier.version
    };
  }

  const classifierResult = evaluateSquadClassifier(fact, classifier);
  return {
    status: classifierResult.matches ? 'matched' as const : 'skipped' as const,
    score: classifierResult.score,
    reasons: [...scopeResult.reasons, ...classifierResult.reasons],
    classifier_key: classifier.key,
    classifier_version: classifier.version
  };
}

function buildClassificationResultKey(classifierKey: string, classifierVersion: number) {
  return `${classifierKey}::v${classifierVersion}`;
}

export async function getLatestSquadClassifierVersion(tenantId: string, squadId: string, key: string) {
  return prisma.squadClassifier.findFirst({
    where: {
      tenantId,
      squadId,
      key
    },
    orderBy: {
      version: 'desc'
    }
  });
}

export async function createNextSquadClassifierVersion(input: CreateSquadClassifierVersionInput) {
  const latest = await getLatestSquadClassifierVersion(input.tenantId, input.squadId, input.key);
  const nextVersion = (latest?.version ?? 0) + 1;

  return prisma.squadClassifier.create({
    data: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      key: input.key,
      appliesToFactType: input.appliesToFactType,
      version: nextVersion,
      status: input.status ?? 'draft',
      config: input.config,
      createdBy: input.createdBy ?? null,
      updatedBy: input.updatedBy ?? null
    }
  });
}

export async function getLatestSquadScopeVersion(tenantId: string, squadId: string) {
  return prisma.squadScope.findFirst({
    where: {
      tenantId,
      squadId
    },
    orderBy: {
      version: 'desc'
    }
  });
}

export async function createNextSquadScopeVersion(input: CreateSquadScopeVersionInput) {
  const latest = await getLatestSquadScopeVersion(input.tenantId, input.squadId);
  const nextVersion = (latest?.version ?? 0) + 1;

  return prisma.squadScope.create({
    data: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      version: nextVersion,
      status: input.status ?? 'draft',
      name: input.name,
      config: input.config,
      createdBy: input.createdBy ?? null,
      updatedBy: input.updatedBy ?? null
    }
  });
}

async function squadExists(tenantId: string, squadId: string) {
  return prisma.squad.findFirst({
    where: {
      tenantId,
      id: squadId
    },
    select: {
      id: true,
      key: true,
      name: true
    }
  });
}

export async function listSquadScopes(input: {
  tenantId: string;
  squadId: string;
  status?: 'draft' | 'active' | 'archived';
  limit?: number;
}) {
  const squad = await squadExists(input.tenantId, input.squadId);
  if (!squad) return null;

  const items = await prisma.squadScope.findMany({
    where: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      ...(input.status ? { status: input.status } : {})
    },
    orderBy: {
      version: 'desc'
    },
    take: input.limit ?? 50
  });

  return {
    squad,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      version: item.version,
      status: item.status,
      config: item.config,
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString()
    }))
  };
}

export async function createDraftSquadScope(input: {
  tenantId: string;
  squadId: string;
  userId?: string | null;
  name: string;
  config: Prisma.InputJsonValue;
}) {
  const squad = await squadExists(input.tenantId, input.squadId);
  if (!squad) return null;

  const scope = await createNextSquadScopeVersion({
    tenantId: input.tenantId,
    squadId: input.squadId,
    name: input.name,
    config: input.config,
    createdBy: input.userId,
    updatedBy: input.userId,
    status: 'draft'
  });

  return {
    id: scope.id,
    squad_id: scope.squadId,
    name: scope.name,
    version: scope.version,
    status: scope.status,
    config: scope.config,
    created_at: scope.createdAt.toISOString(),
    updated_at: scope.updatedAt.toISOString()
  };
}

export async function publishSquadScope(input: {
  tenantId: string;
  squadId: string;
  scopeId: string;
  userId?: string | null;
}) {
  const squad = await squadExists(input.tenantId, input.squadId);
  if (!squad) return null;

  const target = await prisma.squadScope.findFirst({
    where: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      id: input.scopeId
    }
  });

  if (!target) return null;

  await prisma.squadScope.updateMany({
    where: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      status: 'active'
    },
    data: {
      status: 'archived',
      updatedBy: input.userId ?? null
    }
  });

  const published = await prisma.squadScope.update({
    where: { id: target.id },
    data: {
      status: 'active',
      updatedBy: input.userId ?? null
    }
  });

  return {
    id: published.id,
    squad_id: published.squadId,
    name: published.name,
    version: published.version,
    status: published.status,
    updated_at: published.updatedAt.toISOString()
  };
}

export async function listSquadClassifiers(input: {
  tenantId: string;
  squadId: string;
  status?: 'draft' | 'active' | 'archived';
  key?: string;
  limit?: number;
}) {
  const squad = await squadExists(input.tenantId, input.squadId);
  if (!squad) return null;

  const items = await prisma.squadClassifier.findMany({
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
    squad,
    items: items.map((item) => ({
      id: item.id,
      key: item.key,
      applies_to_fact_type: item.appliesToFactType,
      version: item.version,
      status: item.status,
      config: item.config,
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString()
    }))
  };
}

export async function createDraftSquadClassifier(input: {
  tenantId: string;
  squadId: string;
  userId?: string | null;
  key: string;
  appliesToFactType: string;
  config: Prisma.InputJsonValue;
}) {
  const squad = await squadExists(input.tenantId, input.squadId);
  if (!squad) return null;

  const classifier = await createNextSquadClassifierVersion({
    tenantId: input.tenantId,
    squadId: input.squadId,
    key: input.key,
    appliesToFactType: input.appliesToFactType,
    config: input.config,
    createdBy: input.userId,
    updatedBy: input.userId,
    status: 'draft'
  });

  return {
    id: classifier.id,
    squad_id: classifier.squadId,
    key: classifier.key,
    applies_to_fact_type: classifier.appliesToFactType,
    version: classifier.version,
    status: classifier.status,
    config: classifier.config,
    created_at: classifier.createdAt.toISOString(),
    updated_at: classifier.updatedAt.toISOString()
  };
}

export async function publishSquadClassifier(input: {
  tenantId: string;
  squadId: string;
  classifierId: string;
  userId?: string | null;
}) {
  const squad = await squadExists(input.tenantId, input.squadId);
  if (!squad) return null;

  const target = await prisma.squadClassifier.findFirst({
    where: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      id: input.classifierId
    }
  });

  if (!target) return null;

  await prisma.squadClassifier.updateMany({
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

  const published = await prisma.squadClassifier.update({
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
    applies_to_fact_type: published.appliesToFactType,
    version: published.version,
    status: published.status,
    updated_at: published.updatedAt.toISOString()
  };
}

export async function persistClassificationResult(input: PersistClassificationResultInput) {
  const resultKey = buildClassificationResultKey(input.classifier.key, input.classifier.version);

  return prisma.classificationResult.upsert({
    where: {
      tenantId_squadId_canonicalFactId_resultKey: {
        tenantId: input.tenantId,
        squadId: input.squadId,
        canonicalFactId: input.canonicalFactId,
        resultKey
      }
    },
    create: {
      tenantId: input.tenantId,
      squadId: input.squadId,
      classifierId: input.classifier.id ?? null,
      resultKey,
      canonicalFactId: input.canonicalFactId,
      status: input.evaluation.matches ? 'matched' : 'skipped',
      score: input.evaluation.score,
      payload: {
        classifier_key: input.classifier.key,
        classifier_version: input.classifier.version,
        reasons: input.evaluation.reasons,
        payload: input.payload
      } as Prisma.InputJsonValue,
      explanation: input.explanation ? (input.explanation as Prisma.InputJsonValue) : Prisma.JsonNull
    },
    update: {
      classifierId: input.classifier.id ?? null,
      status: input.evaluation.matches ? 'matched' : 'skipped',
      score: input.evaluation.score,
      payload: {
        classifier_key: input.classifier.key,
        classifier_version: input.classifier.version,
        reasons: input.evaluation.reasons,
        payload: input.payload
      } as Prisma.InputJsonValue,
      explanation: input.explanation ? (input.explanation as Prisma.InputJsonValue) : Prisma.JsonNull,
      classifiedAt: new Date()
    }
  });
}

export async function classifyAndPersistCanonicalFact(input: {
  tenantId: string;
  squadId: string;
  canonicalFactId: string;
  fact: CanonicalFactLike;
  scope: SquadScopeDefinition;
  classifier: SquadClassifierDefinition & { id?: string | null };
}) {
  const classification = classifyCanonicalFact(input.fact, input.scope, input.classifier);
  const result = await persistClassificationResult({
    tenantId: input.tenantId,
    squadId: input.squadId,
    canonicalFactId: input.canonicalFactId,
    classifier: {
      id: input.classifier.id ?? null,
      key: input.classifier.key,
      version: input.classifier.version
    },
    evaluation: {
      matches: classification.status === 'matched',
      reasons: classification.reasons,
      score: classification.score
    },
    payload: input.fact.payload,
    explanation: {
      scope: evaluateSquadScope(input.fact, input.scope),
      classifier: classification
    }
  });

  return {
    classification,
    result
  };
}
