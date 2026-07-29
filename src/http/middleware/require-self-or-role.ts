import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SystemRole } from '../../identity/identity.types';

/**
 * Factory de preHandler do Fastify: exige que `request.params.userId` seja
 * o próprio usuário do token (`request.user.userId`, populado por
 * `requireAuth`, que deve rodar antes na cadeia) **ou** que o papel do
 * usuário esteja entre os informados. Primeiro caso de "dono do recurso OU
 * papel elevado" no sistema — até aqui, RBAC sempre foi só por papel
 * (`requireRole`). Base: CLAUDE.md, RBAC — `USUARIO` = "visualização dos
 * seus próprios dados", diferente do resto da API (perfil de time, etc.),
 * que é sempre `ADMIN`/`GESTOR`-only.
 */
export function requireSelfOrRole(...roles: readonly SystemRole[]) {
  return async function requireSelfOrRoleHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { userId } = request.params as { userId?: string };

    if (!request.user) {
      await reply.status(403).send({ error: `Requer ser o próprio usuário ou um dos papéis: ${roles.join(', ')}.` });
      return;
    }

    const isSelf = userId === request.user.userId;
    const hasRole = roles.includes(request.user.systemRole);

    if (!isSelf && !hasRole) {
      await reply.status(403).send({ error: `Requer ser o próprio usuário ou um dos papéis: ${roles.join(', ')}.` });
    }
  };
}
