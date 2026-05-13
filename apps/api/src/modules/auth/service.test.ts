import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock Prisma before any service import ────────────────────────────────────

const mockTx = {
  platformAccount: { create: vi.fn() },
  invite: { update: vi.fn() },
  permissionProfile: { findFirst: vi.fn() },
  userPermissionProfile: { create: vi.fn() }
};

const mockPrisma = vi.hoisted(() => ({
  invite: { findUnique: vi.fn() },
  platformAccount: { findUnique: vi.fn() },
  user: { findFirst: vi.fn() },
  $transaction: vi.fn()
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../lib/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed'),
  verifyPassword: vi.fn()
}));
vi.mock('../comms/service.js', () => ({ enqueueNotification: vi.fn() }));

import { registerByInvite } from './service.js';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invite-1',
    tenantId: 'ten_test',
    email: 'alice@example.com',
    role: 'viewer',
    tokenHash: 'hash',
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides
  };
}

function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    tenantId: 'ten_test',
    email: 'alice@example.com',
    fullName: 'Alice',
    role: 'viewer',
    isActive: true,
    coreUserId: null,
    createdAt: new Date('2026-01-01'),
    ...overrides
  };
}

function makeSystemProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-system-viewer',
    tenantId: 'ten_test',
    name: 'Viewer Default',
    permissionKeys: ['core.task.read', 'dora.read'],
    isSystem: true,
    isActive: true,
    ...overrides
  };
}

// ── registerByInvite — auto-assign default profile ────────────────────────────

describe('registerByInvite — default profile auto-assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.invite.findUnique.mockResolvedValue(makeInvite());
    mockPrisma.platformAccount.findUnique.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue(null);
  });

  it('assigns Viewer Default system profile when role is viewer and profile exists', async () => {
    const account = makeAccount({ role: 'viewer' });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      mockTx.platformAccount.create.mockResolvedValue(account);
      mockTx.invite.update.mockResolvedValue({});
      mockTx.permissionProfile.findFirst.mockResolvedValue(makeSystemProfile());
      mockTx.userPermissionProfile.create.mockResolvedValue({});
      return fn(mockTx);
    });

    await registerByInvite({ invite_token: 'raw-token', password: 'Abcd1234', full_name: 'Alice' });

    expect(mockTx.permissionProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'ten_test',
          isSystem: true,
          isActive: true,
          name: 'Viewer Default'
        })
      })
    );

    expect(mockTx.userPermissionProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountId: 'acc-1',
          permissionProfileId: 'profile-system-viewer',
          tenantId: 'ten_test'
        })
      })
    );
  });

  it('assigns Manager Default system profile when role is manager and profile exists', async () => {
    const account = makeAccount({ role: 'manager' });
    mockPrisma.invite.findUnique.mockResolvedValue(makeInvite({ role: 'manager' }));

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      mockTx.platformAccount.create.mockResolvedValue(account);
      mockTx.invite.update.mockResolvedValue({});
      mockTx.permissionProfile.findFirst.mockResolvedValue(makeSystemProfile({ id: 'profile-mgr', name: 'Manager Default' }));
      mockTx.userPermissionProfile.create.mockResolvedValue({});
      return fn(mockTx);
    });

    await registerByInvite({ invite_token: 'raw-token', password: 'Abcd1234', full_name: 'Alice' });

    expect(mockTx.permissionProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ name: 'Manager Default' })
      })
    );
    expect(mockTx.userPermissionProfile.create).toHaveBeenCalled();
  });

  it('skips profile assignment gracefully when no system profile exists for the role', async () => {
    const account = makeAccount({ role: 'viewer' });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      mockTx.platformAccount.create.mockResolvedValue(account);
      mockTx.invite.update.mockResolvedValue({});
      mockTx.permissionProfile.findFirst.mockResolvedValue(null); // no default profile
      mockTx.userPermissionProfile.create.mockResolvedValue({});
      return fn(mockTx);
    });

    const result = await registerByInvite({ invite_token: 'raw-token', password: 'Abcd1234', full_name: 'Alice' });

    // Account is still created successfully
    expect(result).toMatchObject({ email: 'alice@example.com', role: 'viewer' });
    expect(mockTx.userPermissionProfile.create).not.toHaveBeenCalled();
  });

  it('skips profile assignment for org_admin (has wildcard — no profile needed)', async () => {
    const account = makeAccount({ role: 'org_admin' });
    mockPrisma.invite.findUnique.mockResolvedValue(makeInvite({ role: 'org_admin' }));

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      mockTx.platformAccount.create.mockResolvedValue(account);
      mockTx.invite.update.mockResolvedValue({});
      return fn(mockTx);
    });

    await registerByInvite({ invite_token: 'raw-token', password: 'Abcd1234', full_name: 'Alice' });

    expect(mockTx.permissionProfile.findFirst).not.toHaveBeenCalled();
    expect(mockTx.userPermissionProfile.create).not.toHaveBeenCalled();
  });

  it('throws INVALID_INVITE_TOKEN when invite is expired', async () => {
    mockPrisma.invite.findUnique.mockResolvedValue(
      makeInvite({ expiresAt: new Date(Date.now() - 1000) })
    );

    await expect(
      registerByInvite({ invite_token: 'raw-token', password: 'Abcd1234', full_name: 'Alice' })
    ).rejects.toMatchObject({ code: 'INVALID_INVITE_TOKEN' });
  });

  it('throws EMAIL_TAKEN when account already exists', async () => {
    mockPrisma.platformAccount.findUnique.mockResolvedValue(makeAccount());

    await expect(
      registerByInvite({ invite_token: 'raw-token', password: 'Abcd1234', full_name: 'Alice' })
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });
});
