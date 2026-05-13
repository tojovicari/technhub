import { prisma } from '../../lib/prisma.js';
import type {
  AssignPermissionProfileInput,
  CreatePermissionProfileInput,
  ListProfilesQueryInput,
  UpdatePermissionProfileInput
} from './schema.js';

function mapProfile(p: {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  permissionKeys: string[];
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    tenant_id: p.tenantId,
    name: p.name,
    description: p.description,
    permission_keys: p.permissionKeys,
    is_system: p.isSystem,
    is_active: p.isActive,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString()
  };
}

function mapAssignment(a: {
  id: string;
  tenantId: string;
  accountId: string;
  permissionProfileId: string;
  grantedBy: string;
  grantedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}) {
  return {
    id: a.id,
    tenant_id: a.tenantId,
    user_id: a.accountId,
    permission_profile_id: a.permissionProfileId,
    granted_by: a.grantedBy,
    granted_at: a.grantedAt.toISOString(),
    expires_at: a.expiresAt?.toISOString() ?? null,
    revoked_at: a.revokedAt?.toISOString() ?? null
  };
}

export async function listPermissionProfiles(tenantId: string, query: ListProfilesQueryInput) {
  const where: Record<string, unknown> = { tenantId };
  if (query.is_active !== undefined) where.isActive = query.is_active;
  if (query.is_system !== undefined) where.isSystem = query.is_system;

  const profiles = await prisma.permissionProfile.findMany({
    where,
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }]
  });

  return profiles.map(mapProfile);
}

export async function createPermissionProfile(input: CreatePermissionProfileInput) {
  const profile = await prisma.permissionProfile.create({
    data: {
      tenantId: input.tenant_id,
      name: input.name,
      description: input.description ?? null,
      permissionKeys: input.permission_keys,
      isSystem: false,
      isActive: input.is_active
    }
  });
  return mapProfile(profile);
}

export async function updatePermissionProfile(
  profileId: string,
  tenantId: string,
  input: UpdatePermissionProfileInput
) {
  const existing = await prisma.permissionProfile.findFirst({
    where: { id: profileId, tenantId }
  });

  if (!existing) return null;

  if (existing.isSystem) {
    return { error: 'SYSTEM_PROFILE' as const };
  }

  const updated = await prisma.permissionProfile.update({
    where: { id: profileId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.permission_keys !== undefined && { permissionKeys: input.permission_keys }),
      ...(input.is_active !== undefined && { isActive: input.is_active })
    }
  });

  return mapProfile(updated);
}

export async function assignPermissionProfile(
  userId: string,
  grantedBy: string,
  input: AssignPermissionProfileInput
) {
  const account = await prisma.platformAccount.findFirst({
    where: { id: userId, tenantId: input.tenant_id }
  });
  if (!account) return { error: 'USER_NOT_FOUND' as const };

  const profile = await prisma.permissionProfile.findFirst({
    where: { id: input.permission_profile_id, tenantId: input.tenant_id, isActive: true }
  });
  if (!profile) return { error: 'PROFILE_NOT_FOUND' as const };

  const assignment = await prisma.userPermissionProfile.upsert({
    where: {
      accountId_permissionProfileId: {
        accountId: userId,
        permissionProfileId: input.permission_profile_id
      }
    },
    create: {
      tenantId: input.tenant_id,
      accountId: userId,
      permissionProfileId: input.permission_profile_id,
      grantedBy,
      expiresAt: input.expires_at ? new Date(input.expires_at) : null,
      revokedAt: null
    },
    update: {
      grantedBy,
      grantedAt: new Date(),
      expiresAt: input.expires_at ? new Date(input.expires_at) : null,
      revokedAt: null
    }
  });

  return mapAssignment(assignment);
}

export async function getPermissionProfile(profileId: string, tenantId: string) {
  const profile = await prisma.permissionProfile.findFirst({
    where: { id: profileId, tenantId }
  });
  return profile ? mapProfile(profile) : null;
}

export async function deletePermissionProfile(profileId: string, tenantId: string) {
  const existing = await prisma.permissionProfile.findFirst({
    where: { id: profileId, tenantId }
  });
  if (!existing) return null;
  if (existing.isSystem) return { error: 'SYSTEM_PROFILE' as const };

  await prisma.permissionProfile.delete({ where: { id: profileId } });
  return true;
}

export async function listUserAssignments(userId: string, tenantId: string, includeRevoked = false) {
  const account = await prisma.platformAccount.findFirst({
    where: { id: userId, tenantId }
  });
  if (!account) return null;

  const now = new Date();
  const assignments = await prisma.userPermissionProfile.findMany({
    where: {
      accountId: userId,
      tenantId,
      ...(includeRevoked ? {} : {
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
      })
    },
    include: { permissionProfile: true },
    orderBy: { grantedAt: 'desc' }
  });

  return assignments.map(a => ({
    ...mapAssignment(a),
    profile: mapProfile(a.permissionProfile)
  }));
}

export async function listProfileUsers(profileId: string, tenantId: string) {
  const profile = await prisma.permissionProfile.findFirst({
    where: { id: profileId, tenantId }
  });
  if (!profile) return null;

  const now = new Date();
  const assignments = await prisma.userPermissionProfile.findMany({
    where: {
      permissionProfileId: profileId,
      tenantId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    include: {
      account: {
        select: { id: true, email: true, fullName: true, role: true, isActive: true }
      }
    },
    orderBy: { grantedAt: 'desc' }
  });

  return assignments.map(a => ({
    ...mapAssignment(a),
    account: {
      id: a.account.id,
      email: a.account.email,
      full_name: a.account.fullName,
      role: a.account.role,
      is_active: a.account.isActive
    }
  }));
}

export async function revokePermissionProfile(
  userId: string,
  profileId: string,
  tenantId: string
) {
  const assignment = await prisma.userPermissionProfile.findFirst({
    where: {
      accountId: userId,
      permissionProfileId: profileId,
      tenantId,
      revokedAt: null
    }
  });

  if (!assignment) return null;

  await prisma.userPermissionProfile.update({
    where: { id: assignment.id },
    data: { revokedAt: new Date() }
  });

  return true;
}
