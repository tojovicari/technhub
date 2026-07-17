import type { IntegrationProvider, Prisma, RawSourceChannel } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

const TRANSFORM_VERSION = 'insights-v1';
const SYNC_SOURCE_CHANNELS: RawSourceChannel[] = ['sync_full', 'sync_incremental'];

type DispatchInput = {
  tenantId: string;
  connectionId: string;
  provider: IntegrationProvider;
  ingestedAfter: Date;
};

type DispatchSummary = {
  canonicalized: number;
  skipped: number;
  warnings: string[];
};

type CanonicalCandidate = {
  factType: string;
  factKey: string;
  payload: Prisma.InputJsonValue;
  sourceEntityType: string;
  sourceExternalId: string;
  occurredAt: Date | null;
  extractionPath: string;
  qualityScore: number;
  warnings: string[];
  attributes: Array<{
    attributeName: string;
    valueType: string;
    valueString?: string | null;
    valueNumber?: number | null;
    valueBoolean?: boolean | null;
    valueDatetime?: Date | null;
    valueJson?: Prisma.InputJsonValue | null;
    isMultivalue?: boolean;
  }>;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    if (typeof item === 'string') {
      return item;
    }

    if (item && typeof item === 'object' && 'name' in item && typeof (item as { name?: unknown }).name === 'string') {
      return (item as { name: string }).name;
    }

    return String(item);
  }).filter(Boolean);
}

function candidateFromRawObject(rawObject: {
  provider: IntegrationProvider;
  entityType: string;
  externalId: string;
  payload: Prisma.JsonValue;
  occurredAt: Date | null;
}): CanonicalCandidate | null {
  const payload = toRecord(rawObject.payload);

  if (rawObject.entityType === 'issue') {
    const fields = toRecord(payload.fields);
    const issueTypeRecord = toRecord(fields.issuetype);
    const statusRecord = toRecord(fields.status);
    const statusCategoryRecord = toRecord(statusRecord.statusCategory);
    const labels = normalizeList(fields.labels ?? payload.labels);
    const components = Array.isArray(fields.components) ? fields.components : [];
    const title = toString(fields.summary) ?? toString(payload.title) ?? rawObject.externalId;
    const description = toString(fields.description) ?? toString(payload.body);
    const issueType = toString(issueTypeRecord.name) ?? toString(payload.issue_type);
    const statusRaw = toString(statusCategoryRecord.name)
      ?? toString(statusCategoryRecord.key)
      ?? toString(payload.state)
      ?? toString(statusRecord.name)
      ?? null;

    return {
      factType: 'work_item',
      factKey: `${rawObject.provider}:${rawObject.externalId}`,
      payload: {
        provider: rawObject.provider,
        external_id: rawObject.externalId,
        title,
        description,
        issue_type: issueType,
        status_raw: statusRaw,
        assignee_ref: toString(toRecord(fields.assignee).emailAddress) ?? toString(toRecord(payload.assignee).login),
        reporter_ref: toString(toRecord(fields.reporter).emailAddress) ?? toString(toRecord(payload.user).login),
        labels,
        components,
        story_points: fields.customfield_10016 ?? fields.story_points ?? payload.story_points ?? null,
        created_at: toString(fields.created) ?? toString(payload.created_at),
        updated_at: toString(fields.updated) ?? toString(payload.updated_at),
        completed_at: toString(fields.resolutiondate) ?? toString(payload.closed_at),
      } as Prisma.InputJsonValue,
      sourceEntityType: rawObject.entityType,
      sourceExternalId: rawObject.externalId,
      occurredAt: rawObject.occurredAt,
      extractionPath: 'payload.fields',
      qualityScore: 1,
      warnings: [],
      attributes: [
        { attributeName: 'title', valueType: 'string', valueString: title },
        { attributeName: 'provider', valueType: 'string', valueString: rawObject.provider },
        { attributeName: 'external_id', valueType: 'string', valueString: rawObject.externalId },
        { attributeName: 'issue_type', valueType: 'string', valueString: issueType },
        { attributeName: 'labels', valueType: 'json', valueJson: labels as unknown as Prisma.InputJsonValue, isMultivalue: true },
      ],
    };
  }

  if (rawObject.entityType === 'pull_request') {
    const title = toString(payload.title) ?? rawObject.externalId;
    const labels = normalizeList(payload.labels);

    return {
      factType: 'pull_request',
      factKey: `${rawObject.provider}:${rawObject.externalId}`,
      payload: {
        provider: rawObject.provider,
        external_id: rawObject.externalId,
        title,
        author_ref: toString(toRecord(payload.user).login),
        base_branch: toString(toRecord(payload.base).ref),
        head_branch: toString(toRecord(payload.head).ref),
        state: toString(payload.state),
        created_at: toString(payload.created_at),
        merged_at: toString(payload.merged_at),
        closed_at: toString(payload.closed_at),
        labels,
      } as Prisma.InputJsonValue,
      sourceEntityType: rawObject.entityType,
      sourceExternalId: rawObject.externalId,
      occurredAt: rawObject.occurredAt,
      extractionPath: 'payload',
      qualityScore: 1,
      warnings: [],
      attributes: [
        { attributeName: 'title', valueType: 'string', valueString: title },
        { attributeName: 'provider', valueType: 'string', valueString: rawObject.provider },
        { attributeName: 'external_id', valueType: 'string', valueString: rawObject.externalId },
        { attributeName: 'state', valueType: 'string', valueString: toString(payload.state) },
        { attributeName: 'labels', valueType: 'json', valueJson: labels as unknown as Prisma.InputJsonValue, isMultivalue: true },
      ],
    };
  }

  if (rawObject.entityType === 'incident' || rawObject.entityType === 'alert') {
    const incident = toRecord(payload.incident);
    const alert = toRecord(payload.alert);
    const source = Object.keys(incident).length > 0 ? incident : alert;
    const title = toString(source.name) ?? toString(source.message) ?? rawObject.externalId;
    const status = toString(source.status) ?? 'open';
    const tags = normalizeList(source.tags);

    return {
      factType: 'incident',
      factKey: `${rawObject.provider}:${rawObject.externalId}`,
      payload: {
        provider: rawObject.provider,
        external_id: rawObject.externalId,
        title,
        status,
        priority: toString(source.priority),
        severity: toString(source.severity),
        tags,
        opened_at: toString(source.created_at),
        acknowledged_at: toString(source.acknowledged_at),
        resolved_at: toString(source.resolved_at),
      } as Prisma.InputJsonValue,
      sourceEntityType: rawObject.entityType,
      sourceExternalId: rawObject.externalId,
      occurredAt: rawObject.occurredAt,
      extractionPath: Object.keys(incident).length > 0 ? 'payload.incident' : 'payload.alert',
      qualityScore: 1,
      warnings: [],
      attributes: [
        { attributeName: 'title', valueType: 'string', valueString: title },
        { attributeName: 'status', valueType: 'string', valueString: status },
        { attributeName: 'provider', valueType: 'string', valueString: rawObject.provider },
        { attributeName: 'tags', valueType: 'json', valueJson: tags as unknown as Prisma.InputJsonValue, isMultivalue: true },
      ],
    };
  }

  return null;
}

export async function dispatchCanonicalizationForSync(input: DispatchInput): Promise<DispatchSummary> {
  const rawObjects = await prisma.rawObject.findMany({
    where: {
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      provider: input.provider,
      ingestedAt: { gte: input.ingestedAfter },
      sourceChannel: { in: SYNC_SOURCE_CHANNELS },
      processingStatus: 'processed',
    },
    orderBy: { ingestedAt: 'asc' },
  });

  let canonicalized = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const rawObject of rawObjects) {
    const candidate = candidateFromRawObject(rawObject);
    if (!candidate) {
      skipped++;
      continue;
    }

    const fact = await prisma.canonicalFact.upsert({
      where: {
        tenantId_factType_factKey_canonicalVersion: {
          tenantId: input.tenantId,
          factType: candidate.factType,
          factKey: candidate.factKey,
          canonicalVersion: 1,
        },
      },
      create: {
        tenantId: input.tenantId,
        factType: candidate.factType,
        factKey: candidate.factKey,
        provider: rawObject.provider,
        sourceEntityType: rawObject.entityType,
        sourceExternalId: rawObject.externalId,
        occurredAt: candidate.occurredAt,
        payload: candidate.payload,
        canonicalVersion: 1,
        transformVersion: TRANSFORM_VERSION,
        qualityScore: candidate.qualityScore,
        warnings: candidate.warnings,
      },
      update: {
        occurredAt: candidate.occurredAt,
        payload: candidate.payload,
        transformVersion: TRANSFORM_VERSION,
        qualityScore: candidate.qualityScore,
        warnings: candidate.warnings,
      },
    });

    await prisma.canonicalFactAttribute.deleteMany({
      where: { factId: fact.id },
    });

    if (candidate.attributes.length > 0) {
      await prisma.canonicalFactAttribute.createMany({
        data: candidate.attributes.map((attribute) => ({
          tenantId: input.tenantId,
          factId: fact.id,
          attributeName: attribute.attributeName,
          valueType: attribute.valueType,
          valueString: attribute.valueString ?? null,
          valueNumber: attribute.valueNumber ?? null,
          valueBoolean: attribute.valueBoolean ?? null,
          valueDatetime: attribute.valueDatetime ?? null,
          valueJson: attribute.valueJson ?? undefined,
          isMultivalue: attribute.isMultivalue ?? false,
        })),
      });
    }

    await prisma.canonicalLineage.upsert({
      where: { rawObjectId: rawObject.id },
      create: {
        tenantId: input.tenantId,
        rawObjectId: rawObject.id,
        factId: fact.id,
        transformVersion: TRANSFORM_VERSION,
        extractionPath: candidate.extractionPath,
      },
      update: {
        factId: fact.id,
        transformVersion: TRANSFORM_VERSION,
        extractionPath: candidate.extractionPath,
      },
    });

    canonicalized++;
    warnings.push(...candidate.warnings);
  }

  return { canonicalized, skipped, warnings };
}