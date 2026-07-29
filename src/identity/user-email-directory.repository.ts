import type { Pool, PoolClient } from 'pg';
import { getPool } from '../database/pool';

export interface EmailDirectoryEntry {
  readonly email: string;
  readonly tenantId: string;
  readonly userId: string;
}

/**
 * Persistência de `user_email_directory` (`db/migrations/0034_create_user_email_directory.sql`)
 * — índice cross-tenant email → (tenant_id, user_id), deliberadamente sem
 * RLS. Existe só pra resolver "a qual tenant esse email pertence" no login
 * SSO-first (`auth.routes.ts`), antes do tenant ser conhecido — nunca é a
 * fonte de verdade sobre status/permissão de um usuário, isso continua
 * sendo `UserRepository.findByEmail` (RLS-scoped, sempre atual).
 */
export class UserEmailDirectoryRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  /**
   * Chamado só de dentro da mesma transação de `UserRepository.create()`
   * (mesmo `client`) — uma falha em qualquer um dos dois INSERTs reverte
   * ambos, mantendo o invariante "uma linha aqui por linha em `users`".
   */
  async create(client: PoolClient, entry: EmailDirectoryEntry): Promise<void> {
    await client.query(
      `INSERT INTO user_email_directory (email, tenant_id, user_id) VALUES ($1, $2, $3)`,
      [entry.email, entry.tenantId, entry.userId],
    );
  }

  /** Todos os tenant_ids com um usuário para este email — sem RLS, cross-tenant por design. */
  async findTenantIdsByEmail(email: string): Promise<readonly string[]> {
    const result = await this.pool.query<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id FROM user_email_directory WHERE email = $1`,
      [email],
    );

    return result.rows.map((row) => row.tenant_id);
  }
}
