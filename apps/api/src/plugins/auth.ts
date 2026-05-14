import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fail } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';

type JwtUser = {
  sub: string;
  tenant_id: string;
  roles: string[];
  permissions: string[];
  platform_role?: string | null;
  is_impersonation?: boolean;
  impersonation_audit_id?: string;
};

const DEV_USER: JwtUser = {
  sub: 'usr_dev',
  tenant_id: 'ten_1',
  roles: ['org_admin'],
  permissions: ['*']
};

export async function registerAuth(app: FastifyInstance) {
  if (process.env.AUTH_BYPASS === 'true' && process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_BYPASS is not allowed in production');
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is required');

  app.register(jwt, { secret });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    if (process.env.AUTH_BYPASS === 'true') {
      request.user = DEV_USER;
      return;
    }

    try {
      await request.jwtVerify();
    } catch {
      return reply
        .status(401)
        .send(fail(request, 'UNAUTHORIZED', 'Invalid or missing token'));
    }

    const user = request.user as JwtUser;

    // Block impersonation tokens on /platform/* routes
    if (user?.is_impersonation && request.url.startsWith('/api/v1/platform/')) {
      return reply.status(403).send(
        fail(request, 'FORBIDDEN', 'Impersonation tokens cannot access platform admin routes')
      );
    }

    // Fire-and-forget: register first use of impersonation token
    if (user?.is_impersonation && user?.impersonation_audit_id) {
      prisma.impersonationAudit
        .updateMany({
          where: { id: user.impersonation_audit_id, firstUsedAt: null },
          data: { firstUsedAt: new Date() },
        })
        .catch(() => {});
    }
  });

  app.decorate('requirePermission', (permission: string) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtUser | undefined;
      const permissions = user?.permissions || [];

      if (!permissions.includes('*') && !permissions.includes(permission)) {
        return reply.status(403).send(
          fail(request, 'FORBIDDEN', 'Missing required permission', {
            required_permission: permission,
            reason: 'missing_permission'
          })
        );
      }
    };
  });

  app.decorate('requirePlatformRole', (...allowedRoles: string[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtUser | undefined;
      const platformRole = user?.platform_role;

      if (!platformRole || !allowedRoles.includes(platformRole)) {
        return reply.status(403).send(
          fail(request, 'FORBIDDEN', 'Insufficient platform role', {
            required_roles: allowedRoles,
            current_role: platformRole || null,
            reason: 'insufficient_platform_role'
          })
        );
      }
    };
  });
}

export function ensureTenantScope(
  request: FastifyRequest,
  reply: FastifyReply,
  tenantId: string | undefined
) {
  const user = request.user as JwtUser | undefined;

  if (!tenantId || !user?.tenant_id || tenantId !== user.tenant_id) {
    return reply.status(403).send(
      fail(request, 'FORBIDDEN', 'Tenant scope violation', {
        reason: 'tenant_mismatch'
      })
    );
  }

  return null;
}
