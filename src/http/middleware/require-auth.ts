import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAuthToken } from '../../auth/core/jwt';

const BEARER_PREFIX = 'Bearer ';

/**
 * PreHandler do Fastify: exige `Authorization: Bearer <token>` válido,
 * decorando `request.user` (ver `../fastify.d.ts`) para os handlers e
 * preHandlers seguintes na cadeia.
 *
 * Centraliza também o bloqueio de escrita de sessão de impersonation
 * (`request.user.impersonatedBy` presente) — aqui, não em cada rota, porque
 * **toda** rota tenant-scoped já passa por este middleware; nenhuma rota
 * existente ou futura pode esquecer de checar isso (ver
 * `AuthTokenPayload.impersonatedBy`, `admin.routes.ts`).
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined;

  if (!token) {
    await reply.status(401).send({ error: 'Token de autenticação ausente.' });
    return;
  }

  try {
    request.user = verifyAuthToken(token);
  } catch {
    await reply.status(401).send({ error: 'Token de autenticação inválido ou expirado.' });
    return;
  }

  if (request.user.impersonatedBy && request.method !== 'GET') {
    await reply.status(403).send({ error: 'Sessão de impersonation é somente leitura.' });
  }
}
