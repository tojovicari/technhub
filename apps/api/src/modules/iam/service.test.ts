import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock Prisma before any service import ────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  platformAccount: { findFirst: vi.fn() },
  permissionProfile: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  },
  userPermissionProfile: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import {
  revokePermissionProfile,
  listUserAssignments,
  listProfileUsers,
  assignPermissionProfile
} from './service.js';
import { assignPermissionProfileSchema } from './schema.js';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    tenantId: 'ten_test',
    name: 'Engineer Default',
    description: null,
    permissionKeys: ['core.task.read', 'dora.read'],
    isSystem: false,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides
  };
}

function makeAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assign-1',
    tenantId: 'ten_test',
    accountId: 'user-1',
    permissionProfileId: 'profile-1',
    grantedBy: 'admin-1',
    grantedAt: new Date('2026-01-01'),
    expiresAt: null,
    revokedAt: null,
    ...overrides
  };
}

function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    tenantId: 'ten_test',
    email: 'alice@example.com',
    fullName: 'Alice',
    role: 'engineer',
    isActive: true,
    ...overrides
  };
}

// ── revokePermissionProfile ───────────────────────────────────────────────────

describe('revokePermissionProfile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('soft-revokes the assignment via update (revokedAt)', async () => {
    mockPrisma.userPermissionProfile.findFirst.mockResolvedValue(makeAssignment());
    mockPrisma.userPermissionProfile.update.mockResolvedValue({
      ...makeAssignment(),
      revokedAt: new Date()
    });

    const result = await revokePermissionProfile('user-1', 'profile-1', 'ten_test');

    expect(result).toBe(true);
    expect(mockPrisma.userPermissionProfile.update).toHaveBeenCalledWith({
      where: { id: 'assign-1' },
      data: { revokedAt: expect.any(Date) }
    });
  });

  it('does NOT call delete', async () => {
    mockPrisma.userPermissionProfile.findFirst.mockResolvedValue(makeAssignment());
    mockPrisma.userPermissionProfile.update.mockResolvedValue(makeAssignment());

    await revokePermissionProfile('user-1', 'profile-1', 'ten_test');

    expect(mockPrisma.userPermissionProfile.delete).not.toHaveBeenCalled();
  });

  it('returns null when assignment not found (already revoked or never existed)', async () => {
    mockPrisma.userPermissionProfile.findFirst.mockResolvedValue(null);

    const result = await revokePermissionProfile('user-1', 'profile-1', 'ten_test');

    expect(result).toBeNull();
    expect(mockPrisma.userPermissionProfile.update).not.toHaveBeenCalled();
  });

  it('queries only non-revoked assignments (revokedAt: null)', async () => {
    mockPrisma.userPermissionProfile.findFirst.mockResolvedValue(null);

    await revokePermissionProfile('user-1', 'profile-1', 'ten_test');

    expect(mockPrisma.userPermissionProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revokedAt: null })
      })
    );
  });
});

// ── listUserAssignments ───────────────────────────────────────────────────────

describe('listUserAssignments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries with revokedAt: null to exclude revoked assignments', async () => {
    mockPrisma.platformAccount.findFirst.mockResolvedValue(makeAccount());
    mockPrisma.userPermissionProfile.findMany.mockResolvedValue([]);

    await listUserAssignments('user-1', 'ten_test');

    expect(mockPrisma.userPermissionProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revokedAt: null })
      })
    );
  });

  it('queries with expiresAt filter to exclude expired assignments', async () => {
    mockPrisma.platformAccount.findFirst.mockResolvedValue(makeAccount());
    mockPrisma.userPermissionProfile.findMany.mockResolvedValue([]);

    await listUserAssignments('user-1', 'ten_test');

    const call = mockPrisma.userPermissionProfile.findMany.mock.calls[0][0];
    expect(call.where).toHaveProperty('OR');
    expect(call.where.OR).toEqual(
      expect.arrayContaining([
        { expiresAt: null },
        { expiresAt: expect.objectContaining({ gt: expect.any(Date) }) }
      ])
    );
  });

  it('includes revoked and expired when includeRevoked=true', async () => {
    mockPrisma.platformAccount.findFirst.mockResolvedValue(makeAccount());
    mockPrisma.userPermissionProfile.findMany.mockResolvedValue([]);

    await listUserAssignments('user-1', 'ten_test', true);

    const call = mockPrisma.userPermissionProfile.findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty('revokedAt');
    expect(call.where).not.toHaveProperty('OR');
  });

  it('returns null when user not found', async () => {
    mockPrisma.platformAccount.findFirst.mockResolvedValue(null);

    const result = await listUserAssignments('ghost', 'ten_test');

    expect(result).toBeNull();
  });

  it('returns mapped assignments with inline profile', async () => {
    mockPrisma.platformAccount.findFirst.mockResolvedValue(makeAccount());
    mockPrisma.userPermissionProfile.findMany.mockResolvedValue([
      { ...makeAssignment(), permissionProfile: makeProfile() }
    ]);

    const result = await listUserAssignments('user-1', 'ten_test');

    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({
      id: 'assign-1',
      user_id: 'user-1',
      permission_profile_id: 'profile-1',
      revoked_at: null,
      profile: { id: 'profile-1', permission_keys: ['core.task.read', 'dora.read'] }
    });
  });
});

// ── listProfileUsers ──────────────────────────────────────────────────────────

describe('listProfileUsers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries with revokedAt: null to exclude revoked assignments', async () => {
    mockPrisma.permissionProfile.findFirst.mockResolvedValue(makeProfile());
    mockPrisma.userPermissionProfile.findMany.mockResolvedValue([]);

    await listProfileUsers('profile-1', 'ten_test');

    expect(mockPrisma.userPermissionProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revokedAt: null })
      })
    );
  });

  it('queries with expiresAt filter to exclude expired assignments', async () => {
    mockPrisma.permissionProfile.findFirst.mockResolvedValue(makeProfile());
    mockPrisma.userPermissionProfile.findMany.mockResolvedValue([]);

    await listProfileUsers('profile-1', 'ten_test');

    const call = mockPrisma.userPermissionProfile.findMany.mock.calls[0][0];
    expect(call.where).toHaveProperty('OR');
    expect(call.where.OR).toEqual(
      expect.arrayContaining([
        { expiresAt: null },
        { expiresAt: expect.objectContaining({ gt: expect.any(Date) }) }
      ])
    );
  });

  it('returns null when profile not found', async () => {
    mockPrisma.permissionProfile.findFirst.mockResolvedValue(null);

    const result = await listProfileUsers('ghost', 'ten_test');

    expect(result).toBeNull();
  });
});

// ── assignPermissionProfile ───────────────────────────────────────────────────

describe('assignPermissionProfile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns USER_NOT_FOUND when account does not exist', async () => {
    mockPrisma.platformAccount.findFirst.mockResolvedValue(null);

    const result = await assignPermissionProfile('ghost', 'admin-1', {
      tenant_id: 'ten_test',
      permission_profile_id: 'profile-1'
    });

    expect(result).toEqual({ error: 'USER_NOT_FOUND' });
  });

  it('returns PROFILE_NOT_FOUND when profile is inactive or missing', async () => {
    mockPrisma.platformAccount.findFirst.mockResolvedValue(makeAccount());
    mockPrisma.permissionProfile.findFirst.mockResolvedValue(null);

    const result = await assignPermissionProfile('user-1', 'admin-1', {
      tenant_id: 'ten_test',
      permission_profile_id: 'ghost-profile'
    });

    expect(result).toEqual({ error: 'PROFILE_NOT_FOUND' });
  });

  it('upserts the assignment and clears revokedAt on re-assign', async () => {
    mockPrisma.platformAccount.findFirst.mockResolvedValue(makeAccount());
    mockPrisma.permissionProfile.findFirst.mockResolvedValue(makeProfile());
    mockPrisma.userPermissionProfile.upsert.mockResolvedValue(makeAssignment());

    await assignPermissionProfile('user-1', 'admin-1', {
      tenant_id: 'ten_test',
      permission_profile_id: 'profile-1'
    });

    expect(mockPrisma.userPermissionProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ revokedAt: null })
      })
    );
  });
});

// ── assignPermissionProfileSchema ─────────────────────────────────────────────

describe('assignPermissionProfileSchema', () => {
  it('accepts a future expires_at', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result = assignPermissionProfileSchema.safeParse({
      tenant_id: 'ten_test',
      permission_profile_id: 'profile-1',
      expires_at: future
    });
    expect(result.success).toBe(true);
  });

  it('rejects a past expires_at with validation error', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const result = assignPermissionProfileSchema.safeParse({
      tenant_id: 'ten_test',
      permission_profile_id: 'profile-1',
      expires_at: past
    });
    expect(result.success).toBe(false);
    expect(result.error?.errors[0].message).toBe('expires_at must be a future date');
  });

  it('accepts when expires_at is omitted', () => {
    const result = assignPermissionProfileSchema.safeParse({
      tenant_id: 'ten_test',
      permission_profile_id: 'profile-1'
    });
    expect(result.success).toBe(true);
  });
});
