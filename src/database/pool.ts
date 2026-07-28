import { Pool } from 'pg';
import type { PoolClient } from 'pg';

let pool: Pool | undefined;

/**
 * Retorna a instância singleton do pool de conexões PostgreSQL da aplicação.
 *
 * A string de conexão é lida de `DATABASE_URL` (Postgres nativo em
 * desenvolvimento local, Postgres gerenciado do Fly.io em produção — ver
 * CLAUDE.md, seção "Stack & Infraestrutura"). O pool é criado de forma
 * preguiçosa (lazy) e reutilizado por toda a aplicação.
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }

  return pool;
}

/**
 * Executa `callback` dentro de uma transação com o contexto de tenant
 * (`app.tenant_id`) definido na sessão, exigido pelas policies de Row-Level
 * Security de toda tabela tenant-scoped (`.spec/spec-engineering-intelligence.md`,
 * Seção 4.3).
 *
 * Usa `set_config` parametrizado — nunca interpolação de string — para
 * definir a GUC de sessão com segurança. `COMMIT` confirma a transação;
 * qualquer erro (inclusive uma policy de RLS rejeitando a escrita) reverte
 * tudo via `ROLLBACK`.
 */
export async function withTenantContext<T>(
  pool: Pool,
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

    const result = await callback(client);

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
