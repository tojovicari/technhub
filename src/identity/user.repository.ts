import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { SystemRole, User, UserStatus } from './identity.types';

interface UserRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly primary_email: string;
  readonly full_name: string;
  readonly avatar_url: string | null;
  readonly system_role: SystemRole;
  readonly status: UserStatus;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRowToUser(row: UserRow): User {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    primaryEmail: row.primary_email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    systemRole: row.system_role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateUserInput {
  readonly primaryEmail: string;
  readonly fullName: string;
  readonly avatarUrl?: string;
  readonly systemRole?: SystemRole;
  /**
   * `'INVITED'` por padrão (login-capaz imediatamente — comportamento de
   * sempre pro fluxo de convite). Passar `'DISCOVERED'` explicitamente é o
   * caso de materializar uma identidade só rastreada (sync), sem convidar —
   * ver `POST .../discovered-users/materialize`.
   */
  readonly status?: UserStatus;
}

/**
 * Persistência da tabela `users` (`db/migrations/0006_create_users.sql`).
 *
 * `users` é tenant-scoped: toda escrita roda dentro de `withTenantContext`
 * para satisfazer a policy de Row-Level Security da tabela (Seção 4.3 da spec).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 4.1.
 */
export class UserRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(tenantId: string, input: CreateUserInput): Promise<User> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `INSERT INTO users (tenant_id, primary_email, full_name, avatar_url, system_role, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, tenant_id, primary_email, full_name, avatar_url, system_role, status, created_at, updated_at`,
        [
          tenantId,
          input.primaryEmail,
          input.fullName,
          input.avatarUrl ?? null,
          input.systemRole ?? 'USUARIO',
          input.status ?? 'INVITED',
        ],
      );

      return mapRowToUser(result.rows[0]);
    });
  }

  /** Usado pelo login: casa a identidade externa (email) com um usuário já cadastrado no tenant. */
  async findByEmail(tenantId: string, email: string): Promise<User | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `SELECT id, tenant_id, primary_email, full_name, avatar_url, system_role, status, created_at, updated_at
         FROM users
         WHERE tenant_id = $1 AND primary_email = $2`,
        [tenantId, email],
      );

      return result.rows.length === 0 ? null : mapRowToUser(result.rows[0]);
    });
  }

  /** Usado pelo /auth/refresh: recarrega o usuário (role pode ter mudado desde o login). */
  async findById(tenantId: string, userId: string): Promise<User | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `SELECT id, tenant_id, primary_email, full_name, avatar_url, system_role, status, created_at, updated_at
         FROM users
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, userId],
      );

      return result.rows.length === 0 ? null : mapRowToUser(result.rows[0]);
    });
  }

  /**
   * Registra um login bem-sucedido: avança `INVITED` para `ACTIVE` e
   * atualiza `last_login_at`. Não mexe em `status` se já for `ACTIVE` ou
   * `DISABLED` — desabilitar um usuário é decisão explícita de um ADMIN,
   * login nunca reverte isso. `DISCOVERED` também não avança aqui — nunca
   * deveria chegar até este ponto (o callback OAuth barra antes, ver
   * `auth.routes.ts`), mas o `CASE` já reflete a regra por segurança:
   * materializar uma identidade rastreada (`POST .../discovered-users/materialize`)
   * não deve, por si só, virar acesso à plataforma.
   */
  async markLoggedIn(tenantId: string, userId: string): Promise<User> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `UPDATE users
         SET status = CASE WHEN status = 'INVITED' THEN 'ACTIVE' ELSE status END,
             last_login_at = NOW(),
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, tenant_id, primary_email, full_name, avatar_url, system_role, status, created_at, updated_at`,
        [tenantId, userId],
      );

      return mapRowToUser(result.rows[0]);
    });
  }

  /**
   * Promove `DISCOVERED` → `INVITED` — o convite "de verdade" pra alguém
   * que já foi materializado (`POST .../discovered-users/materialize`) mas
   * ainda não podia logar. `null` se o usuário não existe ou já não está em
   * `DISCOVERED` (nada a promover).
   */
  async markInvited(tenantId: string, userId: string): Promise<User | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `UPDATE users
         SET status = 'INVITED', updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 AND status = 'DISCOVERED'
         RETURNING id, tenant_id, primary_email, full_name, avatar_url, system_role, status, created_at, updated_at`,
        [tenantId, userId],
      );

      return result.rows.length === 0 ? null : mapRowToUser(result.rows[0]);
    });
  }

  /** Lista todos os usuários do tenant — usado pela tela de back office. */
  async findAllByTenant(tenantId: string): Promise<readonly User[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `SELECT id, tenant_id, primary_email, full_name, avatar_url, system_role, status, created_at, updated_at
         FROM users
         WHERE tenant_id = $1
         ORDER BY full_name`,
        [tenantId],
      );

      return result.rows.map(mapRowToUser);
    });
  }

  /** Usado pela regra de bootstrap: um tenant sem nenhum usuário ainda pode criar seu primeiro ADMIN sem auth. */
  async countByTenant(tenantId: string): Promise<number> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM users WHERE tenant_id = $1',
        [tenantId],
      );

      return Number(result.rows[0].count);
    });
  }
}
