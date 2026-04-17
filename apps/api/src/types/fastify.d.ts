import '@fastify/jwt';
import 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      tenant_id: string;
      roles: string[];
      permissions: string[];
      platform_role?: string | null;
    };
    user: {
      sub: string;
      tenant_id: string;
      roles: string[];
      permissions: string[];
      platform_role?: string | null;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      permission: string
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePlatformRole: (
      ...allowedRoles: string[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
