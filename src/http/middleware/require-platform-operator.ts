import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyPlatformOperatorToken } from '../../auth/core/jwt';

const BEARER_PREFIX = 'Bearer ';

/**
 * PreHandler do Fastify: exige `Authorization: Bearer <token>` de gestor do
 * SaaS válido, decorando `request.platformOperator` (ver `../fastify.d.ts`).
 * Independente de `requireAuth`/`request.user` — nunca usado junto na mesma
 * rota, `admin.routes.ts` só usa este.
 */
export async function requirePlatformOperator(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined;

  if (!token) {
    await reply.status(401).send({ error: 'Token de autenticação ausente.' });
    return;
  }

  try {
    request.platformOperator = verifyPlatformOperatorToken(token);
  } catch {
    await reply.status(401).send({ error: 'Token de autenticação inválido ou expirado.' });
  }
}
