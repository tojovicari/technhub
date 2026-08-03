import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAuthToken } from '../../auth/core/jwt';
import { PlatformOperatorAuditLogRepository } from '../../platform-admin/platform-operator-audit-log.repository';

const BEARER_PREFIX = 'Bearer ';

/**
 * Instância própria (não injetada) — `requireAuth` é uma função solta, não
 * uma classe com DI como o resto do código; mesmo padrão de singleton
 * preguiçoso de `getPool()`/`getStripeClient()`.
 */
const auditLogRepository = new PlatformOperatorAuditLogRepository();

/**
 * PreHandler do Fastify: exige `Authorization: Bearer <token>` válido,
 * decorando `request.user` (ver `../fastify.d.ts`) para os handlers e
 * preHandlers seguintes na cadeia.
 *
 * Centraliza também o log de auditoria de escrita em sessão de
 * impersonation (`request.user.impersonatedBy` presente) — aqui, não em
 * cada rota, porque **toda** rota tenant-scoped já passa por este
 * middleware; nenhuma rota existente ou futura pode esquecer de logar isso.
 * Impersonation dá acesso de `ADMIN` completo (decisão deliberada, não é
 * read-only) — este log é o que fica no lugar do bloqueio de escrita que
 * existia antes: toda escrita numa sessão impersonada precisa deixar
 * rastro, sem exceção.
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
    await auditLogRepository.record({
      operatorExternalUserId: request.user.impersonatedBy,
      operatorEmail: request.user.primaryEmail,
      action: 'IMPERSONATED_WRITE',
      targetTenantId: request.user.tenantId,
      targetUserId: request.user.userId,
      metadata: { method: request.method, url: request.url },
    });
  }
}
