import type { PrismaClient } from '@prisma/client';
import type { PolicyEvaluationRequest } from './schema.js';
import { ROUTE_BINDINGS } from './registry.js';

// Role → base permission keys (mirrors auth/service.ts — duplicated intentionally for module isolation)
const ROLE_PERMISSIONS: Record<string, string[]> = {
  org_admin: ['*'],
  manager: [
    'core.read', 'core.write',
    'dora.read', 'sla.read', 'cogs.read', 'intel.read',
    'integrations.read', 'iam.permission_profile.read', 'billing.read'
  ],
  viewer: ['core.read', 'dora.read', 'sla.read', 'intel.read', 'billing.read']
};

function resolveRolePermissions(roles: string[]): Set<string> {
  const perms = new Set<string>();
  for (const role of roles) {
    const base = ROLE_PERMISSIONS[role];
    if (base) base.forEach(p => perms.add(p));
  }
  return perms;
}

// Mirrors the exact-match logic of requirePermission in plugins/auth.ts.
// Wildcard '*' grants everything; otherwise the permission key must be present verbatim.
// Do NOT add prefix matching here — it would diverge from the actual route enforcement.
function hasPermission(effective: Set<string>, required: string): boolean {
  return effective.has('*') || effective.has(required);
}

export async function evaluatePolicy(
  prisma: PrismaClient,
  input: PolicyEvaluationRequest
) {
  const { required_permissions, any_of, subject, resource } = input;

  // Tenant isolation
  if (subject.tenant_id !== resource.tenant_id) {
    return {
      allowed: false,
      decision: 'deny' as const,
      reason: 'tenant_mismatch' as const,
      granted_by: 'none' as const,
      missing_permissions: required_permissions,
      matched_policies: []
    };
  }

  // Build effective permission set from roles
  const effective = resolveRolePermissions(subject.roles ?? []);
  let grantedBy: 'role' | 'permission_profile' | 'direct_permission' | 'none' = 'none';

  // Augment with active permission profile keys (if provided)
  if ((subject.permission_profile_ids?.length ?? 0) > 0 && !effective.has('*')) {
    const now = new Date();
    const assignments = await prisma.userPermissionProfile.findMany({
      where: {
        permissionProfileId: { in: subject.permission_profile_ids! },
        accountId: subject.subject_id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        permissionProfile: { isActive: true, tenantId: subject.tenant_id }
      },
      include: { permissionProfile: { select: { permissionKeys: true } } }
    });

    for (const a of assignments) {
      for (const key of a.permissionProfile.permissionKeys) {
        effective.add(key);
      }
    }
  }

  // Evaluate
  const missing: string[] = [];
  const matched: string[] = [];

  for (const perm of required_permissions) {
    if (hasPermission(effective, perm)) {
      matched.push(perm);
    } else {
      missing.push(perm);
    }
  }

  const allowed = any_of ? matched.length > 0 : missing.length === 0;

  if (allowed) {
    // Determine primary grant source
    const rolePerms = resolveRolePermissions(subject.roles ?? []);
    const grantedByRole = matched.some(p => hasPermission(rolePerms, p));
    grantedBy = grantedByRole ? 'role' : 'permission_profile';
  }

  return {
    allowed,
    decision: allowed ? ('allow' as const) : ('deny' as const),
    reason: allowed
      ? ('granted' as const)
      : ('missing_permission' as const),
    granted_by: grantedBy,
    missing_permissions: missing,
    matched_policies: matched.map(p => `${p}.policy.v1`)
  };
}

export function listRouteBindings(module?: string) {
  if (module) {
    return ROUTE_BINDINGS.filter(b => b.module === module);
  }
  return ROUTE_BINDINGS;
}
