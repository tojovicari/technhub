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
    // Default da lib `pg` é 10 — explícito aqui porque o `/internal/sync` e o
    // painel de administração do SaaS (`admin.routes.ts`) disparam uma
    // chamada por tenant/integração via `Promise.all`; sem `max` configurável,
    // isso trava em 10 conexões simultâneas conforme a base cresce (ver
    // docs/BACKLOG.md, item já resolvido nesta rodada).
    const max = Number(process.env.DATABASE_POOL_MAX ?? 20);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max });
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
