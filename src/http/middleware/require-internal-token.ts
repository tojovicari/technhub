import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * PreHandler do Fastify pra rotas internas (`/internal/*`) — sem `tenantId`
 * na URL, sem JWT de usuário: autenticação por segredo compartilhado
 * (`X-Internal-Token`, comparado com `INTERNAL_SYNC_TOKEN`), mesmo espírito
 * do `FLY_API_TOKEN` já usado no workflow de deploy, só verificado pela
 * própria aplicação em vez de uma action de terceiro.
 */
export async function requireInternalToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const expected = process.env.INTERNAL_SYNC_TOKEN;
  const provided = request.headers['x-internal-token'];

  if (!expected || provided !== expected) {
    await reply.status(401).send({ error: 'Token interno ausente ou inválido.' });
  }
}
