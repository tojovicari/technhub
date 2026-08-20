import type { Pool } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import type { SystemRole, User, UserStatus } from './identity.types';
import { UserEmailDirectoryRepository } from './user-email-directory.repository';

interface UserRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly primary_email: string;
  readonly full_name: string;
  readonly avatar_url: string | null;
  readonly system_role: SystemRole;
  readonly status: UserStatus;
  readonly last_login_at: Date | null;
  readonly last_login_provider: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const USER_COLUMNS =
  'id, tenant_id, primary_email, full_name, avatar_url, system_role, status, last_login_at, last_login_provider, created_at, updated_at';

function mapRowToUser(row: UserRow): User {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    primaryEmail: row.primary_email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    systemRole: row.system_role,
    status: row.status,
    lastLoginAt: row.last_login_at,
    lastLoginProvider: row.last_login_provider,
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
 * Atualização parcial (PATCH): só sobrescreve os campos presentes em
 * `input`, via `COALESCE` contra o valor já gravado — mesmo padrão de
 * `TeamRepository.update`. `primaryEmail` de propósito fora daqui (chave
 * de casamento do login + dual-write em `user_email_directory`, trocar
 * exigiria um fluxo próprio, não cabe numa edição simples de perfil).
 */
export interface UpdateUserInput {
  readonly fullName?: string;
  readonly avatarUrl?: string;
  readonly systemRole?: SystemRole;
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
  constructor(
    private readonly pool: Pool = getPool(),
    private readonly emailDirectoryRepository: UserEmailDirectoryRepository = new UserEmailDirectoryRepository(),
  ) {}

  /**
   * Além de `INSERT INTO users`, grava também em `user_email_directory`
   * (mesma transação/`client` — uma falha em qualquer um dos dois reverte
   * ambos) — é o dual-write que mantém o índice cross-tenant usado pelo
   * login SSO-first (`auth.routes.ts`) sempre em dia. Único call site de
   * `INSERT INTO users` do projeto, então não há outro ponto a sincronizar.
   */
  async create(tenantId: string, input: CreateUserInput): Promise<User> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `INSERT INTO users (tenant_id, primary_email, full_name, avatar_url, system_role, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${USER_COLUMNS}`,
        [
          tenantId,
          input.primaryEmail,
          input.fullName,
          input.avatarUrl ?? null,
          input.systemRole ?? 'USUARIO',
          input.status ?? 'INVITED',
        ],
      );

      const user = mapRowToUser(result.rows[0]);
      await this.emailDirectoryRepository.create(client, {
        email: user.primaryEmail,
        tenantId,
        userId: user.id,
      });

      return user;
    });
  }

  /**
   * Atualização parcial: só sobrescreve o que vier em `input`. `null`
   * quando o usuário não existe neste tenant. Trocar `systemRole` aqui
   * não tem guard nenhum embutido — quem chama (`users.routes.ts`) já
   * checa "não rebaixar o último ADMIN" antes de chegar aqui, mesmo
   * espírito de `disable`.
   */
  async update(tenantId: string, userId: string, input: UpdateUserInput): Promise<User | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `UPDATE users
         SET full_name = COALESCE($3, full_name),
             avatar_url = COALESCE($4, avatar_url),
             system_role = COALESCE($5, system_role),
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${USER_COLUMNS}`,
        [tenantId, userId, input.fullName ?? null, input.avatarUrl ?? null, input.systemRole ?? null],
      );

      return result.rows.length === 0 ? null : mapRowToUser(result.rows[0]);
    });
  }

  /** Usado pelo login: casa a identidade externa (email) com um usuário já cadastrado no tenant. */
  async findByEmail(tenantId: string, email: string): Promise<User | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `SELECT ${USER_COLUMNS}
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
        `SELECT ${USER_COLUMNS}
         FROM users
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, userId],
      );

      return result.rows.length === 0 ? null : mapRowToUser(result.rows[0]);
    });
  }

  /**
   * Registra um login bem-sucedido: avança `INVITED` para `ACTIVE`,
   * atualiza `last_login_at` e grava qual `AuthProvider` foi usado
   * (`last_login_provider`, ex: 'github'/'google'/'microsoft'/'slack').
   * Não mexe em `status` se já for `ACTIVE` ou `DISABLED` — desabilitar um
   * usuário é decisão explícita de um ADMIN, login nunca reverte isso.
   * `DISCOVERED` também não avança aqui — nunca deveria chegar até este
   * ponto (o callback OAuth barra antes, ver `auth.routes.ts`), mas o
   * `CASE` já reflete a regra por segurança: materializar uma identidade
   * rastreada (`POST .../discovered-users/materialize`) não deve, por si
   * só, virar acesso à plataforma.
   */
  async markLoggedIn(tenantId: string, userId: string, provider: string): Promise<User> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `UPDATE users
         SET status = CASE WHEN status = 'INVITED' THEN 'ACTIVE' ELSE status END,
             last_login_at = NOW(),
             last_login_provider = $3,
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${USER_COLUMNS}`,
        [tenantId, userId, provider],
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
         RETURNING ${USER_COLUMNS}`,
        [tenantId, userId],
      );

      return result.rows.length === 0 ? null : mapRowToUser(result.rows[0]);
    });
  }

  /** Lista todos os usuários do tenant — usado pela tela de back office. */
  async findAllByTenant(tenantId: string): Promise<readonly User[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `SELECT ${USER_COLUMNS}
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

  /**
   * Cancela um convite pendente (`INVITED`) ou desabilita um usuário
   * ativo (`ACTIVE`) — mesma ação em pontos diferentes do ciclo de vida,
   * daí um método só. `finishLoginForTenant` (`auth.routes.ts`) já
   * bloqueia login pra `DISABLED`, isso só grava o status. `null` se não
   * achar ou já estiver `DISABLED`.
   */
  async disable(tenantId: string, userId: string): Promise<User | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `UPDATE users
         SET status = 'DISABLED', updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 AND status != 'DISABLED'
         RETURNING ${USER_COLUMNS}`,
        [tenantId, userId],
      );

      return result.rows.length === 0 ? null : mapRowToUser(result.rows[0]);
    });
  }

  /**
   * Reverte um `disable` — restaura pro status certo, não sempre
   * `ACTIVE`: quem nunca chegou a logar (convite cancelado antes de
   * aceitar) volta pra `INVITED` (ainda precisa aceitar o convite); quem
   * já tinha acesso de verdade (`last_login_at` preenchido) volta direto
   * pra `ACTIVE`. `null` se não achar ou não estiver `DISABLED`.
   */
  async enable(tenantId: string, userId: string): Promise<User | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `UPDATE users
         SET status = CASE WHEN last_login_at IS NOT NULL THEN 'ACTIVE' ELSE 'INVITED' END,
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 AND status = 'DISABLED'
         RETURNING ${USER_COLUMNS}`,
        [tenantId, userId],
      );

      return result.rows.length === 0 ? null : mapRowToUser(result.rows[0]);
    });
  }

  /**
   * Usado só pelo guard de "não desabilitar o último ADMIN" em
   * `disable` (rota) — sem isso, um tenant pode ficar travado pra
   * sempre (bootstrap só reabre com `countByTenant === 0`, e um usuário
   * `DISABLED` ainda conta pra esse total).
   */
  async countActiveAdmins(tenantId: string): Promise<number> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users
         WHERE tenant_id = $1 AND system_role = 'ADMIN' AND status != 'DISABLED'`,
        [tenantId],
      );

      return Number(result.rows[0].count);
    });
  }
}
