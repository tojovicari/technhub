import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAuthToken } from '../../auth/core/jwt';

const BEARER_PREFIX = 'Bearer ';

/**
 * PreHandler do Fastify: exige `Authorization: Bearer <token>` válido,
 * decorando `request.user` (ver `../fastify.d.ts`) para os handlers e
 * preHandlers seguintes na cadeia.
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
  }
}
