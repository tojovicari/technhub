import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type {
  InsightsCalculationPolicyConfig,
  InsightsCalculationPolicyHistoryQuery,
  InsightsCalculationPolicyPublishBody,
  InsightsCalculationPolicyPutBody
} from './schema.js';

export type CalculationPolicySource = 'resource_group' | 'tenant_default' | 'legacy';

export type ResolvedCalculationPolicy = {
  source: CalculationPolicySource;
  policy: {
    id: string;
    tenantId: string;
    resourceGroupId: string | null;
    name: string;
    status: 'draft' | 'active' | 'archived';
    version: number;
    effectiveFrom: Date | null;
    effectiveTo: Date | null;
    config: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

type ResolveCalculationPolicyInput = {
  tenantId: string;
  resourceGroupId: string;
  at?: Date;
};

type VersionScopeInput = {
  tenantId: string;
  resourceGroupId?: string | null;
};

type CreateDraftCalculationPolicyInput = {
  tenantId: string;
  resourceGroupId: string;
  userId: string;
  body: InsightsCalculationPolicyPutBody;
};

type PublishDraftCalculationPolicyInput = {
  tenantId: string;
  resourceGroupId: string;
  userId: string;
  body: InsightsCalculationPolicyPublishBody;
};

type ListCalculationPolicyHistoryInput = {
  tenantId: string;
  resourceGroupId: string;
  query: InsightsCalculationPolicyHistoryQuery;
};

type ActivePolicyView = {
  resource_group_id: string;
  policy_source: CalculationPolicySource;
  policy: {
    id: string;
    name: string;
    status: 'draft' | 'active' | 'archived';
    version: number;
    effective_from: string | null;
    effective_to: string | null;
    config: Prisma.JsonValue;
    created_at: string;
    updated_at: string;
  } | null;
};

type PolicyHistoryView = {
  id: string;
  resource_group_id: string | null;
  name: string;
  status: 'draft' | 'active' | 'archived';
  version: number;
  effective_from: string | null;
  effective_to: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type PolicyMappingCandidate = {
  provider: 'jira' | 'github' | 'manual';
  source_type: string;
  match: string;
};

type PolicyMappingCandidatesView = {
  resource_group_id: string;
  items: PolicyMappingCandidate[];
  defaults: {
    task_statuses: string[];
  };
};

type CreateDraftPolicyResult =
  | { error: 'GROUP_NOT_FOUND' | 'OVERLAPPING_STATUS_MAPPING' }
  | { data: PolicyHistoryView & { config: Prisma.JsonValue } };

type PublishDraftPolicyResult =
  | { error: 'GROUP_NOT_FOUND' | 'DRAFT_NOT_FOUND' | 'INVALID_EFFECTIVE_RANGE' }
  | { error: 'ACTIVE_POLICY_CONFLICT'; conflictPolicyId: string }
  | { data: PolicyHistoryView & { config: Prisma.JsonValue } };

const DEFAULT_TASK_STATUS_CANDIDATES = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'];

function normalizeMappingKey(provider: string, sourceType: string, match: string) {
  return `${provider.toLowerCase()}::${sourceType.toLowerCase()}::${match.toLowerCase()}`;
}

function hasOverlappingStatusMapping(config: InsightsCalculationPolicyConfig) {
  const seen = new Set<string>();
  const stateMapping = config.state_mapping;
  const states = Object.keys(stateMapping) as Array<keyof typeof stateMapping>;

  for (const state of states) {
    for (const entry of stateMapping[state]) {
      const key = normalizeMappingKey(entry.provider, entry.source_type, entry.match);
      if (seen.has(key)) {
        return true;
      }
      seen.add(key);
    }
  }

  return false;
}

function toPolicyStatus(status: string): 'draft' | 'active' | 'archived' {
  if (status === 'active' || status === 'archived' || status === 'draft') {
    return status;
  }
  return 'draft';
}

function mapPolicy(record: {
  id: string;
  resourceGroupId: string | null;
  name: string;
  status: string;
  version: number;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    resource_group_id: record.resourceGroupId,
    name: record.name,
    status: toPolicyStatus(record.status),
    version: record.version,
    effective_from: record.effectiveFrom?.toISOString() ?? null,
    effective_to: record.effectiveTo?.toISOString() ?? null,
    created_by: record.createdBy,
    updated_by: record.updatedBy,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString()
  };
}

function rangeOverlaps(
  leftStart: Date | null,
  leftEnd: Date | null,
  rightStart: Date | null,
  rightEnd: Date | null
) {
  const leftStartMs = leftStart?.getTime() ?? Number.NEGATIVE_INFINITY;
  const leftEndMs = leftEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightStartMs = rightStart?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightEndMs = rightEnd?.getTime() ?? Number.POSITIVE_INFINITY;

  return leftStartMs <= rightEndMs && rightStartMs <= leftEndMs;
}

async function resourceGroupExists(tenantId: string, resourceGroupId: string) {
  const group = await prisma.resourceGroup.findFirst({
    where: {
      id: resourceGroupId,
      tenantId
    },
    select: { id: true }
  });

  return Boolean(group);
}

function isActiveAt(
  policy: { effectiveFrom: Date | null; effectiveTo: Date | null },
  timestamp: Date
) {
  const startsOk = policy.effectiveFrom == null || policy.effectiveFrom.getTime() <= timestamp.getTime();
  const endsOk = policy.effectiveTo == null || policy.effectiveTo.getTime() >= timestamp.getTime();
  return startsOk && endsOk;
}

async function findActiveCandidates(tenantId: string, resourceGroupId: string | null) {
  return prisma.resourceGroupCalculationPolicy.findMany({
    where: {
      tenantId,
      resourceGroupId,
      status: 'active'
    },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }]
  });
}

export async function resolveActiveCalculationPolicy(
  input: ResolveCalculationPolicyInput
): Promise<ResolvedCalculationPolicy> {
  const timestamp = input.at ?? new Date();

  const resourceGroupPolicies = await findActiveCandidates(input.tenantId, input.resourceGroupId);
  const resourceGroupPolicy = resourceGroupPolicies.find((policy) => isActiveAt(policy, timestamp));
  if (resourceGroupPolicy) {
    return {
      source: 'resource_group',
      policy: resourceGroupPolicy
    };
  }

  const tenantDefaultPolicies = await findActiveCandidates(input.tenantId, null);
  const tenantDefaultPolicy = tenantDefaultPolicies.find((policy) => isActiveAt(policy, timestamp));
  if (tenantDefaultPolicy) {
    return {
      source: 'tenant_default',
      policy: tenantDefaultPolicy
    };
  }

  return {
    source: 'legacy',
    policy: null
  };
}

export async function getNextCalculationPolicyVersion(input: VersionScopeInput) {
  const latest = await prisma.resourceGroupCalculationPolicy.findFirst({
    where: {
      tenantId: input.tenantId,
      resourceGroupId: input.resourceGroupId ?? null
    },
    orderBy: [{ version: 'desc' }],
    select: { version: true }
  });

  return (latest?.version ?? 0) + 1;
}

export async function getActiveCalculationPolicyForResourceGroup(
  tenantId: string,
  resourceGroupId: string,
  at?: Date
): Promise<ActivePolicyView | null> {
  const exists = await resourceGroupExists(tenantId, resourceGroupId);
  if (!exists) return null;

  const resolved = await resolveActiveCalculationPolicy({
    tenantId,
    resourceGroupId,
    at
  });

  return {
    resource_group_id: resourceGroupId,
    policy_source: resolved.source,
    policy: resolved.policy
      ? {
          id: resolved.policy.id,
          name: resolved.policy.name,
          status: toPolicyStatus(resolved.policy.status),
          version: resolved.policy.version,
          effective_from: resolved.policy.effectiveFrom?.toISOString() ?? null,
          effective_to: resolved.policy.effectiveTo?.toISOString() ?? null,
          config: resolved.policy.config,
          created_at: resolved.policy.createdAt.toISOString(),
          updated_at: resolved.policy.updatedAt.toISOString()
        }
      : null
  };
}

export async function createDraftCalculationPolicy(
  input: CreateDraftCalculationPolicyInput
): Promise<CreateDraftPolicyResult> {
  const exists = await resourceGroupExists(input.tenantId, input.resourceGroupId);
  if (!exists) {
    return { error: 'GROUP_NOT_FOUND' };
  }

  if (hasOverlappingStatusMapping(input.body.config)) {
    return { error: 'OVERLAPPING_STATUS_MAPPING' };
  }

  const version = await getNextCalculationPolicyVersion({
    tenantId: input.tenantId,
    resourceGroupId: input.resourceGroupId
  });

  const created = await prisma.resourceGroupCalculationPolicy.create({
    data: {
      tenantId: input.tenantId,
      resourceGroupId: input.resourceGroupId,
      name: input.body.name,
      status: 'draft',
      version,
      config: input.body.config,
      createdBy: input.userId,
      updatedBy: input.userId
    }
  });

  return {
    data: {
      ...mapPolicy(created),
      config: created.config
    }
  };
}

export async function publishDraftCalculationPolicy(
  input: PublishDraftCalculationPolicyInput
): Promise<PublishDraftPolicyResult> {
  const exists = await resourceGroupExists(input.tenantId, input.resourceGroupId);
  if (!exists) {
    return { error: 'GROUP_NOT_FOUND' };
  }

  const draft = await prisma.resourceGroupCalculationPolicy.findFirst({
    where: {
      id: input.body.draft_id,
      tenantId: input.tenantId,
      resourceGroupId: input.resourceGroupId,
      status: 'draft'
    }
  });

  if (!draft) {
    return { error: 'DRAFT_NOT_FOUND' };
  }

  if (hasOverlappingStatusMapping(draft.config as InsightsCalculationPolicyConfig)) {
    return { error: 'INVALID_EFFECTIVE_RANGE' };
  }

  const effectiveFrom = input.body.effective_from ?? new Date();
  const effectiveTo = input.body.effective_to ?? null;

  if (effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
    return { error: 'INVALID_EFFECTIVE_RANGE' };
  }

  const activePolicies = await prisma.resourceGroupCalculationPolicy.findMany({
    where: {
      tenantId: input.tenantId,
      resourceGroupId: input.resourceGroupId,
      status: 'active',
      id: { not: draft.id }
    },
    select: {
      id: true,
      effectiveFrom: true,
      effectiveTo: true
    }
  });

  const conflict = activePolicies.find((policy) =>
    rangeOverlaps(effectiveFrom, effectiveTo, policy.effectiveFrom, policy.effectiveTo)
  );

  if (conflict) {
    return {
      error: 'ACTIVE_POLICY_CONFLICT',
      conflictPolicyId: conflict.id
    };
  }

  const published = await prisma.resourceGroupCalculationPolicy.update({
    where: { id: draft.id },
    data: {
      status: 'active',
      effectiveFrom,
      effectiveTo,
      updatedBy: input.userId
    }
  });

  return {
    data: {
      ...mapPolicy(published),
      config: published.config
    }
  };
}

export async function listCalculationPolicyHistory(
  input: ListCalculationPolicyHistoryInput
): Promise<{ resource_group_id: string; items: PolicyHistoryView[] } | null> {
  const exists = await resourceGroupExists(input.tenantId, input.resourceGroupId);
  if (!exists) {
    return null;
  }

  const where: Prisma.ResourceGroupCalculationPolicyWhereInput = input.query.include_defaults
    ? {
        tenantId: input.tenantId,
        OR: [{ resourceGroupId: input.resourceGroupId }, { resourceGroupId: null }]
      }
    : {
        tenantId: input.tenantId,
        resourceGroupId: input.resourceGroupId
      };

  const items = await prisma.resourceGroupCalculationPolicy.findMany({
    where,
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    take: input.query.limit
  });

  return {
    resource_group_id: input.resourceGroupId,
    items: items.map(mapPolicy)
  };
}

export async function listCalculationPolicyMappingCandidatesForResourceGroup(
  tenantId: string,
  resourceGroupId: string
): Promise<PolicyMappingCandidatesView | null> {
  const group = await prisma.resourceGroup.findFirst({
    where: {
      id: resourceGroupId,
      tenantId
    },
    select: {
      id: true,
      resources: {
        select: {
          projectId: true
        }
      }
    }
  });

  if (!group) return null;

  const projectIds = Array.from(new Set(group.resources.map((resource) => resource.projectId)));
  const taskRows = projectIds.length > 0
    ? await prisma.task.findMany({
        where: {
          tenantId,
          projectId: { in: projectIds }
        },
        select: {
          source: true,
          status: true
        },
        distinct: ['source', 'status']
      })
    : [];

  const items = taskRows
    .map((row) => ({
      provider: row.source,
      source_type: 'task_status',
      match: row.status
    }))
    .sort((a, b) => {
      if (a.provider === b.provider) return a.match.localeCompare(b.match);
      return a.provider.localeCompare(b.provider);
    });

  return {
    resource_group_id: resourceGroupId,
    items,
    defaults: {
      task_statuses: DEFAULT_TASK_STATUS_CANDIDATES
    }
  };
}
