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
 * Payload do `state` assinado do fluxo OAuth: carrega o tenant através do
 * redirect (login não sabe o tenant de antemão — Seção 4.3, RLS) e amarra o
 * `state` a um provider específico, prevenindo reuso entre providers.
 */
export interface OAuthStatePayload {
  readonly tenantId: string;
  readonly provider: string;
}
