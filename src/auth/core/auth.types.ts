import type { SystemRole } from '../../identity/identity.types';

/**
 * Identidade normalizada devolvida por qualquer `AuthProvider`, independente
 * de qual provedor de OAuth a originou (GitHub, Slack, Teams, Jira, ...).
 */
export interface ExternalIdentity {
  readonly externalUserId: string;
  readonly email: string;
  readonly name?: string;
  readonly avatarUrl?: string;
}

/** Payload assinado no JWT de acesso (`Authorization: Bearer <token>`). */
export interface AuthTokenPayload {
  readonly userId: string;
  readonly tenantId: string;
  readonly systemRole: SystemRole;
  readonly primaryEmail: string;
}

/**
 * Payload do `state` assinado do fluxo OAuth: amarra o `state` a um provider
 * específico, prevenindo reuso entre providers. `tenantId` é opcional — só
 * presente no atalho de deep-link (ex: link de convite por email, que já
 * sabe o tenant); no login normal (SSO-first), o tenant é resolvido depois
 * do callback via `user_email_directory` (ver `auth.routes.ts`).
 */
export interface OAuthStatePayload {
  readonly tenantId?: string;
  readonly provider: string;
}

/**
 * Payload do token de propósito único emitido quando o mesmo email resolve
 * pra mais de um tenant (login SSO-first) — carrega só o suficiente pra
 * `POST /auth/select-tenant` re-verificar a candidatura depois que o
 * usuário escolhe um workspace. `purpose` existe porque todos os tipos de
 * JWT deste módulo compartilham o mesmo `AUTH_JWT_SECRET`, sem `iss`/`aud` —
 * é o que impede um `AuthTokenPayload`/`OAuthStatePayload` de ser aceito por
 * engano onde um `PendingTenantSelectionPayload` era esperado (e vice-versa).
 */
export interface PendingTenantSelectionPayload {
  readonly purpose: 'pending-tenant-selection';
  readonly email: string;
  readonly provider: string;
}

/**
 * Payload do token do "gestor do SaaS" (platform operator) — dono da
 * plataforma, não um `User` de tenant nenhum. Emitido no callback OAuth
 * quando `identity.externalUserId` bate com `PLATFORM_OPERATOR_GITHUB_IDS`
 * (`platform-operator-allowlist.ts`), em vez de resolver tenant.
 *
 * Propositalmente **não** é um `AuthTokenPayload` com `tenantId`/`systemRole`
 * fictícios — é um tipo à parte, verificado por um middleware à parte
 * (`requirePlatformOperator`), pra nunca ser confundido com/aceito no lugar
 * de um token tenant-scoped (mesmo `purpose`-discriminador de
 * `PendingTenantSelectionPayload`, mesmo `AUTH_JWT_SECRET` compartilhado).
 */
export interface PlatformOperatorTokenPayload {
  readonly purpose: 'platform-operator';
  readonly externalUserId: string;
  readonly primaryEmail: string;
  readonly name?: string;
}
