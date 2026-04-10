import type { IntegrationProvider, Prisma, SecretStrategy } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getConnector } from './connectors/registry.js';
import type { CreateConnectionInput, CreateSyncJobInput, RotateSecretInput } from './schema.js';

function inferSecretStrategy(credentials?: unknown): SecretStrategy {
  if (
    credentials &&
    typeof credentials === 'object' &&
    'secret_ref' in credentials &&
    typeof (credentials as { secret_ref?: unknown }).secret_ref === 'string'
  ) {
    return 'vault_ref';
  }

  return 'db_encrypted';
}

function encodeLocalEncryptedBlob(credentials: unknown): string {
  const raw = JSON.stringify({
    encrypted_at: new Date().toISOString(),
    payload: credentials
  });

  return Buffer.from(raw).toString('base64');
}

async function ensureTenant(tenantId: string) {
  await prisma.tenant.upsert({
    where: { id: tenantId },
    create: {
      id: tenantId,
      name: `Tenant ${tenantId}`,
      slug: tenantId
    },
    update: {}
  });
}

export async function createConnection(input: CreateConnectionInput) {
  await ensureTenant(input.tenant_id);

  const connector = getConnector(input.provider);
  await connector.validateConfiguration();

  const secretStrategy = inferSecretStrategy(input.credentials);

  const connection = await prisma.integrationConnection.create({
    data: {
      tenantId: input.tenant_id,
      provider: input.provider,
      scope: (input.scope ?? undefined) as Prisma.InputJsonValue | undefined,
      status: 'active',
      secretStrategy,
      secretLastRotatedAt: input.credentials ? new Date() : null
    }
  });

  if (input.credentials) {
    await prisma.integrationSecret.create({
      data: {
        tenantId: input.tenant_id,
        connectionId: connection.id,
        strategy: secretStrategy,
        encryptedBlob: encodeLocalEncryptedBlob(input.credentials),
        version: 1
      }
    });
  }

  return connection;
}

export async function rotateSecret(connectionId: string, input: RotateSecretInput) {
  const connection = await prisma.integrationConnection.findFirst({
    where: {
      id: connectionId,
      tenantId: input.tenant_id
    }
  });

  if (!connection) {
    return null;
  }

  const strategy = inferSecretStrategy(input.credentials);

  const latestSecret = await prisma.integrationSecret.findFirst({
    where: { connectionId, tenantId: input.tenant_id },
    orderBy: { version: 'desc' }
  });

  await prisma.integrationSecret.create({
    data: {
      tenantId: input.tenant_id,
      connectionId,
      strategy,
      encryptedBlob: encodeLocalEncryptedBlob(input.credentials),
      version: latestSecret ? latestSecret.version + 1 : 1
    }
  });

  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: {
      secretStrategy: strategy,
      secretLastRotatedAt: new Date()
    }
  });

  return true;
}

function decodeSecret(encryptedBlob: string): Record<string, unknown> {
  try {
    const decoded = JSON.parse(Buffer.from(encryptedBlob, 'base64').toString('utf8'));
    return decoded.payload as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function resolveLastSyncDate(connectionId: string, tenantId: string): Promise<Date | undefined> {
  const lastSuccess = await prisma.integrationSyncJob.findFirst({
    where: { connectionId, tenantId, status: 'success' },
    orderBy: { finishedAt: 'desc' }
  });
  return lastSuccess?.finishedAt ?? undefined;
}

export async function createSyncJob(input: CreateSyncJobInput) {
  const connection = await prisma.integrationConnection.findFirst({
    where: {
      id: input.connection_id,
      tenantId: input.tenant_id
    }
  });

  if (!connection) {
    return null;
  }

  const job = await prisma.integrationSyncJob.create({
    data: {
      tenantId: input.tenant_id,
      connectionId: input.connection_id,
      mode: input.mode,
      status: 'running',
      startedAt: new Date()
    }
  });

  try {
    // Resolve credentials and scope to pass into the connector
    const secret = await prisma.integrationSecret.findFirst({
      where: { connectionId: connection.id, tenantId: input.tenant_id },
      orderBy: { version: 'desc' }
    });
    const credentials = secret ? decodeSecret(secret.encryptedBlob) : undefined;
    const scope = (connection.scope as Record<string, unknown> | null) ?? undefined;
    const sinceDate = input.mode === 'incremental'
      ? await resolveLastSyncDate(connection.id, input.tenant_id)
      : undefined;

    const connector = getConnector(connection.provider);
    const result = await connector.runSync({
      tenantId: input.tenant_id,
      connectionId: input.connection_id,
      mode: input.mode,
      credentials,
      scope,
      sinceDate
    });

    const updated = await prisma.integrationSyncJob.update({
      where: { id: job.id },
      data: {
        status: 'success',
        finishedAt: new Date(),
        result
      }
    });

    return updated;
  } catch (error) {
    const updated = await prisma.integrationSyncJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorSummary: error instanceof Error ? error.message : 'Unknown sync error'
      }
    });

    return updated;
  }
}

export async function getSyncJob(jobId: string, tenantId: string) {
  return prisma.integrationSyncJob.findFirst({
    where: {
      id: jobId,
      tenantId
    }
  });
}

export async function listConnections(tenantId: string) {
  return prisma.integrationConnection.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      syncJobs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          errorSummary: true
        }
      }
    }
  });
}

export async function getConnection(connectionId: string, tenantId: string) {
  return prisma.integrationConnection.findFirst({
    where: { id: connectionId, tenantId }
  });
}

export async function updateConnection(
  connectionId: string,
  tenantId: string,
  input: { status?: 'active' | 'disabled'; scope?: Record<string, unknown> }
) {
  const connection = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, tenantId }
  });

  if (!connection) return null;

  return prisma.integrationConnection.update({
    where: { id: connectionId },
    data: {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.scope !== undefined && { scope: input.scope as Prisma.InputJsonValue })
    }
  });
}

export async function deleteConnection(connectionId: string, tenantId: string) {
  const connection = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, tenantId }
  });

  if (!connection) return null;

  await prisma.integrationSecret.deleteMany({ where: { connectionId } });
  await prisma.integrationSyncJob.deleteMany({ where: { connectionId } });
  await prisma.integrationConnection.delete({ where: { id: connectionId } });

  return true;
}

export async function getTypeMapping(
  connectionId: string,
  tenantId: string
): Promise<Record<string, string> | null> {
  const connection = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, tenantId },
    select: { typeMapping: true }
  });

  if (!connection) return null;

  return (connection.typeMapping as Record<string, string> | null) ?? {};
}

export async function updateTypeMapping(
  connectionId: string,
  tenantId: string,
  mapping: Record<string, string>
): Promise<Record<string, string> | null> {
  const connection = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, tenantId }
  });

  if (!connection) return null;

  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: { typeMapping: mapping as Prisma.InputJsonValue }
  });

  return mapping;
}

export async function getOriginalTypes(
  connectionId: string,
  tenantId: string
): Promise<string[] | null> {
  const connection = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, tenantId },
    select: { id: true }
  });

  if (!connection) return null;

  const rows = await prisma.task.findMany({
    where: { connectionId, tenantId, originalType: { not: null } },
    select: { originalType: true },
    distinct: ['originalType']
  });

  return rows
    .map(r => r.originalType!)
    .filter(Boolean)
    .sort();
}

export async function getAllOriginalTypes(tenantId: string): Promise<string[]> {
  const rows = await prisma.task.findMany({
    where: { tenantId, originalType: { not: null } },
    select: { originalType: true },
    distinct: ['originalType']
  });

  return rows
    .map(r => r.originalType!)
    .filter(Boolean)
    .sort();
}
