import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../../database/pool';

const REFRESH_TOKEN_BYTES = 32;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export interface IssuedRefreshToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Persistência da tabela `refresh_tokens` (`db/migrations/0007_create_refresh_tokens.sql`).
 *
 * O token em claro só existe na resposta de `issue()` — a partir daí, só o
 * hash SHA-256 é guardado, e toda verificação recalcula o hash do token
 * recebido pra comparar. Um dump do banco nunca expõe um refresh token
 * reutilizável, mesmo princípio das credenciais de integração cifradas.
 *
 * Tenant-scoped: toda operação roda dentro de `withTenantContext` (RLS,
 * Seção 4.3 da spec).
 */
export class RefreshTokenRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /** Emite um novo refresh token (30 dias) para o usuário, devolvendo o valor em claro. */
  async issue(tenantId: string, userId: string): Promise<IssuedRefreshToken> {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await withTenantContext(this.pool, tenantId, (client) =>
      client.query(
        `INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, userId, tokenHash, expiresAt],
      ),
    );

    return { token, expiresAt };
  }

  /** Verifica um refresh token (não expirado, não revogado). `null` se inválido. */
  async verify(tenantId: string, rawToken: string): Promise<{ userId: string } | null> {
    const tokenHash = hashToken(rawToken);

    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ user_id: string }>(
        `SELECT user_id FROM refresh_tokens
         WHERE tenant_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > NOW()`,
        [tenantId, tokenHash],
      );

      if (result.rows.length === 0) {
        return null;
      }

      return { userId: result.rows[0].user_id };
    });
  }

  /** Revoga um refresh token (usado no logout). Idempotente. */
  async revoke(tenantId: string, rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);

    await withTenantContext(this.pool, tenantId, (client) =>
      client.query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
         WHERE tenant_id = $1 AND token_hash = $2 AND revoked_at IS NULL`,
        [tenantId, tokenHash],
      ),
    );
  }

  /**
   * Revoga todos os refresh tokens de um usuário — usado por
   * `UserRepository.disable` (`users.routes.ts`), pra barrar qualquer
   * `POST /auth/refresh` futuro na hora. O `accessToken` já emitido
   * continua válido até expirar sozinho (JWT stateless, TTL de 1h,
   * `requireAuth` nunca consulta o banco) — mesma janela de exposição já
   * aceita pra impersonation nesta base de código.
   */
  async revokeAllForUser(tenantId: string, userId: string): Promise<void> {
    await withTenantContext(this.pool, tenantId, (client) =>
      client.query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
         WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [tenantId, userId],
      ),
    );
  }
}
