import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SystemRole } from '../../identity/identity.types';

/**
 * Factory de preHandler do Fastify: exige que `request.user.systemRole`
 * (populado por `requireAuth`, que deve rodar antes na cadeia) esteja entre
 * os papéis informados.
 */
export function requireRole(...roles: readonly SystemRole[]) {
  return async function requireRoleHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user || !roles.includes(request.user.systemRole)) {
      await reply.status(403).send({ error: `Requer um dos papéis: ${roles.join(', ')}.` });
    }
  };
}
