import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock Prisma before any service import ────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  userPermissionProfile: { findMany: vi.fn() }
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { evaluatePolicy, listRouteBindings } from './service.js';
import type { PrismaClient } from '@prisma/client';
import { ROUTE_BINDINGS } from './registry.js';

const prisma = mockPrisma as unknown as PrismaClient;

// ── Factories ─────────────────────────────────────────────────────────────────

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    action: 'core.task.update',
    required_permissions: ['core.task.write'],
    any_of: true,
    subject: {
      subject_id: 'acc-1',
      tenant_id: 'ten_1',
      roles: ['viewer'],
      permission_profile_ids: []
    },
    resource: {
      resource_type: 'task',
      resource_id: 'task-1',
      tenant_id: 'ten_1'
    },
    ...overrides
  };
}

// ── evaluatePolicy ────────────────────────────────────────────────────────────

describe('evaluatePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.userPermissionProfile.findMany.mockResolvedValue([]);
  });

  it('denies when subject and resource tenant_id differ', async () => {
    const input = makeRequest({
      resource: { resource_type: 'task', resource_id: 'task-1', tenant_id: 'ten_OTHER' }
    });
    const result = await evaluatePolicy(prisma, input as never);
    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('tenant_mismatch');
    expect(result.granted_by).toBe('none');
  });

  it('allows org_admin via wildcard (*) without hitting DB', async () => {
    const input = makeRequest({
      subject: { subject_id: 'acc-1', tenant_id: 'ten_1', roles: ['org_admin'], permission_profile_ids: [] }
    });
    const result = await evaluatePolicy(prisma, input as never);
    expect(result.allowed).toBe(true);
    expect(result.decision).toBe('allow');
    expect(result.granted_by).toBe('role');
    expect(mockPrisma.userPermissionProfile.findMany).not.toHaveBeenCalled();
  });

  it('allows when permission matches role (viewer with core.read)', async () => {
    const input = makeRequest({
      required_permissions: ['core.read'],
      subject: { subject_id: 'acc-1', tenant_id: 'ten_1', roles: ['viewer'], permission_profile_ids: [] }
    });
    const result = await evaluatePolicy(prisma, input as never);
    expect(result.allowed).toBe(true);
    expect(result.granted_by).toBe('role');
    expect(result.missing_permissions).toHaveLength(0);
  });

  it('denies viewer when requesting a manager-only permission', async () => {
    const input = makeRequest({
      required_permissions: ['core.write'],
      subject: { subject_id: 'acc-1', tenant_id: 'ten_1', roles: ['viewer'], permission_profile_ids: [] }
    });
    const result = await evaluatePolicy(prisma, input as never);
    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('missing_permission');
    expect(result.missing_permissions).toContain('core.write');
  });

  it('allows with any_of=true when at least one permission matches', async () => {
    const input = makeRequest({
      required_permissions: ['core.read', 'core.write'],
      any_of: true,
      subject: { subject_id: 'acc-1', tenant_id: 'ten_1', roles: ['viewer'], permission_profile_ids: [] }
    });
    const result = await evaluatePolicy(prisma, input as never);
    expect(result.allowed).toBe(true);
    expect(result.matched_policies).toContain('core.read.policy.v1');
  });

  it('denies with any_of=false (all required) when one permission is missing', async () => {
    const input = makeRequest({
      required_permissions: ['core.read', 'core.write'],
      any_of: false,
      subject: { subject_id: 'acc-1', tenant_id: 'ten_1', roles: ['viewer'], permission_profile_ids: [] }
    });
    const result = await evaluatePolicy(prisma, input as never);
    expect(result.allowed).toBe(false);
    expect(result.missing_permissions).toContain('core.write');
  });

  it('allows when permission is granted via active permission profile', async () => {
    mockPrisma.userPermissionProfile.findMany.mockResolvedValue([
      {
        permissionProfile: { permissionKeys: ['core.task.write'] }
      }
    ]);

    const input = makeRequest({
      required_permissions: ['core.task.write'],
      subject: {
        subject_id: 'acc-1',
        tenant_id: 'ten_1',
        roles: ['viewer'],
        permission_profile_ids: ['prof-1']
      }
    });
    const result = await evaluatePolicy(prisma, input as never);
    expect(result.allowed).toBe(true);
    expect(result.granted_by).toBe('permission_profile');
  });

  it('includes matched_policies as perm.policy.v1 format', async () => {
    const input = makeRequest({
      required_permissions: ['core.read'],
      subject: { subject_id: 'acc-1', tenant_id: 'ten_1', roles: ['viewer'], permission_profile_ids: [] }
    });
    const result = await evaluatePolicy(prisma, input as never);
    expect(result.matched_policies[0]).toBe('core.read.policy.v1');
  });

  it('denies exact-miss: role has core.read but required is core.read.specific (exact match only)', async () => {
    // Verifies alignment with requirePermission middleware: no prefix matching
    const input = makeRequest({
      required_permissions: ['core.read.specific'],
      subject: { subject_id: 'acc-1', tenant_id: 'ten_1', roles: ['viewer'], permission_profile_ids: [] }
    });
    const result = await evaluatePolicy(prisma, input as never);
    expect(result.allowed).toBe(false);
    expect(result.missing_permissions).toContain('core.read.specific');
  });
});

// ── listRouteBindings ─────────────────────────────────────────────────────────

describe('listRouteBindings', () => {
  it('returns all bindings when no module filter given', () => {
    const result = listRouteBindings();
    expect(result).toHaveLength(ROUTE_BINDINGS.length);
    expect(result.length).toBeGreaterThan(0);
  });

  it('filters bindings by module', () => {
    const result = listRouteBindings('iam');
    expect(result.every(b => b.module === 'iam')).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty array for unknown module', () => {
    const result = listRouteBindings('unknown_module');
    expect(result).toHaveLength(0);
  });

  it('each binding has required fields', () => {
    const result = listRouteBindings();
    for (const b of result) {
      expect(b).toHaveProperty('id');
      expect(b).toHaveProperty('module');
      expect(b).toHaveProperty('method');
      expect(b).toHaveProperty('path');
      expect(typeof b.tenant_enforced).toBe('boolean');
      expect(Array.isArray(b.required_permissions)).toBe(true);
    }
  });

  it('returns only dora bindings when module=dora', () => {
    const result = listRouteBindings('dora');
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(b => b.module === 'dora')).toBe(true);
  });
});
