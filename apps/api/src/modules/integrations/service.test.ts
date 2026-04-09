import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock Prisma and connectors before any service import ──────────────────────
// vi.mock factories are hoisted; use vi.hoisted() to safely share references

const mockPrisma = vi.hoisted(() => ({
  tenant: { upsert: vi.fn() },
  integrationConnection: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  integrationSecret: { create: vi.fn(), findFirst: vi.fn() },
  integrationSyncJob: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() }
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

// Stub connectors so we don't need real credentials
vi.mock('./connectors/jira.js', () => ({
  JiraConnector: vi.fn().mockImplementation(() => ({
    validateConfiguration: vi.fn().mockResolvedValue(undefined),
    runSync: vi.fn().mockResolvedValue({ synced_entities: 5 })
  }))
}));

vi.mock('./connectors/github.js', () => ({
  GithubConnector: vi.fn().mockImplementation(() => ({
    validateConfiguration: vi.fn().mockResolvedValue(undefined),
    runSync: vi.fn().mockResolvedValue({ synced_entities: 3 })
  }))
}));

import { createConnection, createSyncJob, getSyncJob, rotateSecret } from './service.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    tenantId: 'ten_test',
    provider: 'github',
    status: 'active',
    secretStrategy: 'db_encrypted',
    secretLastRotatedAt: null,
    scope: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function makeSyncJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    tenantId: 'ten_test',
    connectionId: 'conn-1',
    mode: 'incremental',
    status: 'completed',
    startedAt: new Date(),
    completedAt: new Date(),
    itemsSynced: 3,
    errorMessage: null,
    createdAt: new Date(),
    ...overrides
  };
}

// ── createConnection ──────────────────────────────────────────────────────────

describe('createConnection', () => {
  beforeEach(() => {
    mockPrisma.tenant.upsert.mockResolvedValue({});
    mockPrisma.integrationConnection.create.mockResolvedValue(makeConnection());
    mockPrisma.integrationSecret.create.mockResolvedValue({});
  });

  it('upserts tenant and creates connection', async () => {
    await createConnection({
      tenant_id: 'ten_test',
      provider: 'github',
      name: 'GitHub Prod'
    } as never);

    expect(mockPrisma.tenant.upsert).toHaveBeenCalled();
    expect(mockPrisma.integrationConnection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'ten_test', provider: 'github' })
      })
    );
  });

  it('creates a secret when credentials are provided', async () => {
    await createConnection({
      tenant_id: 'ten_test',
      provider: 'github',
      name: 'GitHub Prod',
      credentials: { token: 'ghp_secret' }
    } as never);

    expect(mockPrisma.integrationSecret.create).toHaveBeenCalled();
  });

  it('does not create a secret when no credentials are provided', async () => {
    await createConnection({
      tenant_id: 'ten_test',
      provider: 'github',
      name: 'GitHub Prod'
    } as never);

    expect(mockPrisma.integrationSecret.create).not.toHaveBeenCalled();
  });

  it('uses vault_ref strategy when credentials are a secret_ref object', async () => {
    await createConnection({
      tenant_id: 'ten_test',
      provider: 'github',
      name: 'GitHub Prod',
      credentials: { secret_ref: 'vault://path/to/secret' }
    } as never);

    const createData = mockPrisma.integrationConnection.create.mock.calls[0][0].data;
    expect(createData.secretStrategy).toBe('vault_ref');
  });

  it('uses db_encrypted strategy for non-ref credentials', async () => {
    await createConnection({
      tenant_id: 'ten_test',
      provider: 'jira',
      name: 'Jira Prod',
      credentials: { api_token: 'secret123' }
    } as never);

    const createData = mockPrisma.integrationConnection.create.mock.calls[0][0].data;
    expect(createData.secretStrategy).toBe('db_encrypted');
  });
});

// ── rotateSecret ──────────────────────────────────────────────────────────────

describe('rotateSecret', () => {
  it('returns null when connection is not found or belongs to different tenant', async () => {
    mockPrisma.integrationConnection.findFirst.mockResolvedValue(null);

    const result = await rotateSecret('conn-x', {
      tenant_id: 'ten_test',
      credentials: { token: 'new-token' }
    } as never);

    expect(result).toBeNull();
    expect(mockPrisma.integrationSecret.create).not.toHaveBeenCalled();
  });

  it('creates a new secret version when connection exists', async () => {
    mockPrisma.integrationConnection.findFirst.mockResolvedValue(makeConnection());
    mockPrisma.integrationSecret.findFirst.mockResolvedValue({ version: 2 });
    mockPrisma.integrationSecret.create.mockResolvedValue({});
    mockPrisma.integrationConnection.update.mockResolvedValue({});

    await rotateSecret('conn-1', {
      tenant_id: 'ten_test',
      credentials: { token: 'new-token' }
    } as never);

    const newSecret = mockPrisma.integrationSecret.create.mock.calls[0][0].data;
    expect(newSecret.version).toBe(3); // prev version 2 + 1
  });
});

// ── createSyncJob ─────────────────────────────────────────────────────────────

describe('createSyncJob', () => {
  beforeEach(() => {
    mockPrisma.integrationSyncJob.create.mockResolvedValue(makeSyncJob());
    mockPrisma.integrationSyncJob.update.mockResolvedValue(makeSyncJob({ status: 'completed' }));
  });

  it('returns null when connection is not found', async () => {
    mockPrisma.integrationConnection.findFirst.mockResolvedValue(null);

    const result = await createSyncJob({
      tenant_id: 'ten_test',
      connection_id: 'conn-x',
      mode: 'incremental'
    } as never);

    expect(result).toBeNull();
  });

  it('creates sync job and runs connector sync', async () => {
    mockPrisma.integrationConnection.findFirst.mockResolvedValue(makeConnection({ provider: 'github' }));

    await createSyncJob({
      tenant_id: 'ten_test',
      connection_id: 'conn-1',
      mode: 'incremental'
    } as never);

    expect(mockPrisma.integrationSyncJob.create).toHaveBeenCalled();
    expect(mockPrisma.integrationSyncJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'success' })
      })
    );
  });
});

// ── getSyncJob — tenant isolation ─────────────────────────────────────────────

describe('getSyncJob — tenant isolation', () => {
  it('returns null when job does not exist for the given tenant', async () => {
    mockPrisma.integrationSyncJob.findFirst.mockResolvedValue(null);

    const result = await getSyncJob('job-x', 'ten_test');

    expect(result).toBeNull();
    // The query must always filter by tenantId
    expect(mockPrisma.integrationSyncJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'ten_test' })
      })
    );
  });

  it('returns the job when it belongs to the requesting tenant', async () => {
    mockPrisma.integrationSyncJob.findFirst.mockResolvedValue(makeSyncJob());

    const result = await getSyncJob('job-1', 'ten_test');

    expect(result).toBeTruthy();
    expect((result as { id: string }).id).toBe('job-1');
  });

  it('cannot retrieve a job belonging to a different tenant', async () => {
    // Simulates a query for ten_other that finds nothing (Prisma enforces it via WHERE)
    mockPrisma.integrationSyncJob.findFirst.mockResolvedValue(null);

    const result = await getSyncJob('job-1', 'ten_other');

    expect(result).toBeNull();
    expect(mockPrisma.integrationSyncJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'job-1', tenantId: 'ten_other' })
      })
    );
  });
});
