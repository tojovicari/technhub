/**
 * Módulo de Gestão de Identidades e Times (Unified Identity & Access Engine).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 4.
 */

/** Status de ciclo de vida de um tenant. */
export type TenantStatus = 'ACTIVE' | 'SUSPENDED';

/** Raiz do isolamento multi-tenant (Seção 1, Princípio 5). */
export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Perfis de acesso RBAC (CLAUDE.md — Autorização). */
export type SystemRole = 'ADMIN' | 'GESTOR' | 'USUARIO';

/** Status de onboarding de um usuário na plataforma. */
export type UserStatus = 'DISCOVERED' | 'INVITED' | 'ACTIVE' | 'DISABLED';

/** Entidade Composta de usuário (dados da plataforma; aliases de provider ficam em outra tabela). */
export interface User {
  readonly id: string;
  readonly tenantId: string;
  readonly primaryEmail: string;
  readonly fullName: string;
  readonly avatarUrl: string | null;
  readonly systemRole: SystemRole;
  readonly status: UserStatus;
  /** `null` pra quem nunca logou ainda (DISCOVERED/INVITED). */
  readonly lastLoginAt: Date | null;
  /** Provider (`AuthProvider.providerName`) usado no login mais recente — `null` junto com `lastLoginAt`. */
  readonly lastLoginProvider: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Ciclo de planejamento usado no cálculo de capacidade do time. */
export type PlanningCycle = 'MONTHLY' | 'WEEKLY' | 'BIWEEKLY_SPRINT';

/** Status de ciclo de vida de um time — arquivar é soft delete, não apaga nada (ver `TeamRepository.archive`). */
export type TeamStatus = 'ACTIVE' | 'ARCHIVED';

/** Time com parametrização de capacidade (Seção 4.1). */
export interface Team {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly defaultMonthlyCapacityHours: number;
  readonly planningCycle: PlanningCycle;
  readonly workingDaysPerWeek: number;
  readonly status: TeamStatus;
  /** Data do último arquivamento — não é limpo num `unarchive`, fica como registro histórico. */
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Associação e alocação de um usuário num time, com possível sobrescrita de capacidade. */
export interface TeamMembership {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly teamId: string;
  readonly roleInTeam: string;
  readonly capacityAllocationPercent: number;
  readonly customMonthlyCapacityHours: number | null;
  readonly joinedAt: Date;
}

/**
 * Alias de um usuário num provedor externo (ex: username do GitHub) — a
 * ponte que liga `assignee_external_id`/`author_external_id` da Camada
 * Canônica de volta a uma pessoa real na Enriched Layer.
 */
export interface UserProviderAlias {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly provider: string;
  readonly externalUserId: string;
  readonly externalUsername: string | null;
  readonly externalEmail: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
}
