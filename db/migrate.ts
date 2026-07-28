import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Pool } from 'pg';
import { getPool } from '../src/database/pool';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Runner de migrations sem ORM (consistente com o resto do projeto — `pg`
 * cru, sem Prisma/Knex/etc.). `schema_migrations` é metadado de
 * infraestrutura do banco inteiro, não de um tenant — por isso, ao
 * contrário de toda outra tabela do projeto, não tem `tenant_id`/RLS.
 *
 * Uso:
 *   npm run migrate            — roda migrations pendentes, em ordem
 *   npm run migrate:status     — lista o que já rodou vs. pendente
 *   npm run migrate:baseline   — marca os arquivos atuais como aplicados
 *                                 sem rodar (uso único, ao adotar este
 *                                 runner num banco cujas migrations já
 *                                 foram aplicadas manualmente)
 */

async function ensureTrackingTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
}

function listMigrationFiles(): readonly string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
}

async function getAppliedFilenames(pool: Pool): Promise<ReadonlySet<string>> {
  const result = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((row) => row.filename));
}

async function runPendingMigrations(pool: Pool): Promise<void> {
  await ensureTrackingTable(pool);

  const applied = await getAppliedFilenames(pool);
  const pending = listMigrationFiles().filter((filename) => !applied.has(filename));

  if (pending.length === 0) {
    console.log('Nenhuma migration pendente.');
    return;
  }

  for (const filename of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.log(`✓ ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`✗ ${filename} falhou — interrompendo.`);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function showStatus(pool: Pool): Promise<void> {
  await ensureTrackingTable(pool);

  const applied = await getAppliedFilenames(pool);

  for (const filename of listMigrationFiles()) {
    console.log(`${applied.has(filename) ? '[x]' : '[ ]'} ${filename}`);
  }
}

/**
 * Marca todos os arquivos atuais como aplicados sem executar nada. Uso
 * único: adotar este runner num banco cujas migrations já rodaram
 * manualmente (`psql -f`) antes dele existir.
 */
async function baseline(pool: Pool): Promise<void> {
  await ensureTrackingTable(pool);

  const files = listMigrationFiles();
  for (const filename of files) {
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [
      filename,
    ]);
  }

  console.log(`Baseline: ${files.length} migrations marcadas como já aplicadas.`);
}

async function main(): Promise<void> {
  const pool = getPool();
  const mode = process.argv[2];

  try {
    if (mode === '--status') {
      await showStatus(pool);
    } else if (mode === '--baseline') {
      await baseline(pool);
    } else {
      await runPendingMigrations(pool);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
