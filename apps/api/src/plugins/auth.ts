import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fail } from '../lib/http.js';

type JwtUser = {
  sub: string;
  tenant_id: string;
  roles: string[];
  permissions: string[];
  platform_role?: string | null;  // 'super_admin' | 'platform_admin' | null
};

const DEV_USER: JwtUser = {
  sub: 'usr_dev',
  tenant_id: 'ten_1',
  roles: ['org_admin'],
  permissions: ['*']
};

export async function registerAuth(app: FastifyInstance) {
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
