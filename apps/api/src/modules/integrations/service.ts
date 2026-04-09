import type { IntegrationProvider, Prisma, SecretStrategy } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { GithubConnector } from './connectors/github.js';
import { JiraConnector } from './connectors/jira.js';
import type { CreateConnectionInput, CreateSyncJobInput, RotateSecretInput } from './schema.js';

function getConnector(provider: IntegrationProvider) {
  if (provider === 'jira') {
    return new JiraConnector();
  }

  return new GithubConnector();
}

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
    const connector = getConnector(connection.provider);
    const result = await connector.runSync({
      tenantId: input.tenant_id,
      connectionId: input.connection_id,
      mode: input.mode
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
