import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * PreHandler do Fastify: exige que `:tenantId` na URL bata com o tenant do
 * token verificado (`requireAuth` deve rodar antes na cadeia). Defesa em
 * profundidade além do RLS — impede que um token válido de um tenant seja
 * usado contra a URL de outro tenant.
 */
export async function requireSameTenant(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { tenantId } = request.params as { tenantId?: string };

  if (!request.user || tenantId !== request.user.tenantId) {
    await reply.status(403).send({ error: 'Token não pertence a este tenant.' });
  }
}
