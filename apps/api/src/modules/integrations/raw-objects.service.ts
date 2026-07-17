import { createHash } from 'crypto';
import type { IntegrationProvider, Prisma, SyncMode } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

type PersistRawSyncObjectsInput<T> = {
  tenantId: string;
  connectionId?: string;
  provider: IntegrationProvider;
  entityType: string;
  objects: T[];
  mode: SyncMode;
  getExternalId: (object: T) => string | number | null | undefined;
  getOccurredAt?: (object: T) => Date | string | null | undefined;
  getParentExternalId?: (object: T) => string | number | null | undefined;
  getEventType?: (object: T) => string | null | undefined;
  getSchemaHint?: (object: T) => string | null | undefined;
};

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

export async function persistRawSyncObjects<T>(
  input: PersistRawSyncObjectsInput<T>,
): Promise<{ inserted: number; deduplicated: number }> {
  const sourceChannel: Prisma.RawObjectCreateManyInput['sourceChannel'] =
    input.mode === 'full' ? 'sync_full' : 'sync_incremental';
  const now = new Date();

  const rows: Prisma.RawObjectCreateManyInput[] = input.objects.flatMap((object) => {
    const externalId = input.getExternalId(object);
    if (externalId == null || externalId === '') {
      return [];
    }

    const occurredAt = input.getOccurredAt?.(object);
    const eventType = input.getEventType?.(object) ?? input.entityType;
    const schemaHint = input.getSchemaHint?.(object) ?? `${input.provider}.${input.entityType}`;

    return [{
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      provider: input.provider,
      entityType: input.entityType,
      externalId: String(externalId),
      parentExternalId: input.getParentExternalId?.(object)?.toString() ?? null,
      eventType,
      sourceChannel,
      payload: object as Prisma.InputJsonValue,
      payloadHash: hashPayload(object),
      occurredAt: occurredAt ? new Date(occurredAt) : null,
      ingestedAt: now,
      firstSeenAt: now,
      lastSeenAt: now,
      processingStatus: 'queued' as const,
      schemaHint,
    }];
  });

  if (rows.length === 0) {
    return { inserted: 0, deduplicated: 0 };
  }

  const result = await prisma.rawObject.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return {
    inserted: result.count,
    deduplicated: rows.length - result.count,
  };
}

export async function markRawSyncObjectsAsProcessed(input: {
  tenantId: string;
  connectionId: string;
  provider: IntegrationProvider;
  sourceChannel: Prisma.RawObjectCreateManyInput['sourceChannel'];
  ingestedAfter: Date;
}) {
  return prisma.rawObject.updateMany({
    where: {
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      provider: input.provider,
      sourceChannel: input.sourceChannel,
      ingestedAt: { gte: input.ingestedAfter },
      processingStatus: 'queued',
    },
    data: {
      processingStatus: 'processed',
      lastSeenAt: new Date(),
    },
  });
}

export async function markRawSyncObjectsAsFailed(input: {
  tenantId: string;
  connectionId: string;
  provider: IntegrationProvider;
  sourceChannel: Prisma.RawObjectCreateManyInput['sourceChannel'];
  ingestedAfter: Date;
  errorSummary: string;
}) {
  return prisma.rawObject.updateMany({
    where: {
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      provider: input.provider,
      sourceChannel: input.sourceChannel,
      ingestedAt: { gte: input.ingestedAfter },
      processingStatus: 'queued',
    },
    data: {
      processingStatus: 'failed',
      processingError: input.errorSummary,
      lastSeenAt: new Date(),
    },
  });
}