import jwt from 'jsonwebtoken';
import type {
  AuthTokenPayload,
  OAuthStatePayload,
  PendingTenantSelectionPayload,
  PlatformOperatorTokenPayload,
} from './auth.types';

/** TTL curto: reduz a janela de exposição caso o access token vaze. */
const ACCESS_TOKEN_TTL = '1h';
/**
 * Mesmo TTL do token normal (`ACCESS_TOKEN_TTL`) — era `15m` (bem mais
 * curto, decisão original de quando impersonation era read-only); ajustado
 * pra `60m` por pedido explícito depois que impersonation passou a dar
 * acesso completo de `ADMIN` (a compensação de segurança pra isso é o
 * audit log de toda escrita, não mais um TTL curto — ver `admin.routes.ts`).
 */
const IMPERSONATION_TOKEN_TTL = '60m';
/**
 * TTL curto o bastante pra cobrir o round-trip do redirect OAuth, nada além
 * disso — reaproveitado também pelo token de seleção de tenant (mesma
 * janela de "termine o que começou ou reinicie o login").
 */
export const OAUTH_STATE_TTL = '10m';

function requireJwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;

  if (!secret) {
    throw new Error(
      'AUTH_JWT_SECRET não está definida — necessária para assinar/verificar tokens de autenticação.',
    );
  }

  return secret;
}

/** Assina o access token JWT (`Authorization: Bearer <token>`). */
export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, requireJwtSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

/**
 * Assina um access token de impersonation — mesma forma de `AuthTokenPayload`
 * (`impersonatedBy` precisa vir preenchido), TTL bem mais curto que o normal.
 * Reaproveita `verifyAuthToken` pra verificar, já que a forma é a mesma.
 */
export function signImpersonationToken(payload: AuthTokenPayload & { readonly impersonatedBy: string }): string {
  return jwt.sign(payload, requireJwtSecret(), { expiresIn: IMPERSONATION_TOKEN_TTL });
}

/**
 * Verifica e decodifica um access token.
 *
 * @throws {Error} Se o token for inválido, expirado ou tiver payload incompleto.
 */
export function verifyAuthToken(token: string): AuthTokenPayload {
  const decoded = jwt.verify(token, requireJwtSecret());

  if (typeof decoded === 'string') {
    throw new Error('Token de acesso malformado.');
  }

  const { userId, tenantId, systemRole, primaryEmail, impersonatedBy } = decoded as Partial<AuthTokenPayload>;
  if (!userId || !tenantId || !systemRole || !primaryEmail) {
    throw new Error('Token de acesso com payload incompleto.');
  }

  return { userId, tenantId, systemRole, primaryEmail, ...(impersonatedBy ? { impersonatedBy } : {}) };
}

/** Assina o `state` do fluxo OAuth: protege contra CSRF, carrega provider (e tenant, só no atalho de deep-link). */
export function signOAuthState(payload: OAuthStatePayload): string {
  return jwt.sign(payload, requireJwtSecret(), { expiresIn: OAUTH_STATE_TTL });
}

/**
 * Verifica e decodifica um `state` OAuth. `tenantId` é opcional (ver
 * `OAuthStatePayload`) — só `provider` é sempre exigido.
 *
 * @throws {Error} Se o `state` for inválido, expirado ou tiver payload incompleto.
 */
export function verifyOAuthState(token: string): OAuthStatePayload {
  const decoded = jwt.verify(token, requireJwtSecret());

  if (typeof decoded === 'string') {
    throw new Error('state OAuth malformado.');
  }

  const { tenantId, provider } = decoded as Partial<OAuthStatePayload>;
  if (!provider) {
    throw new Error('state OAuth com payload incompleto.');
  }

  return { tenantId, provider };
}

/**
 * Assina o token de propósito único emitido quando um email resolve pra
 * mais de um tenant no login SSO-first — ver `PendingTenantSelectionPayload`.
 */
export function signPendingTenantSelection(payload: PendingTenantSelectionPayload): string {
  return jwt.sign(payload, requireJwtSecret(), { expiresIn: OAUTH_STATE_TTL });
}

/**
 * Verifica e decodifica um token de seleção de tenant. Exige `purpose`
 * exato — impede que um `AuthTokenPayload`/`OAuthStatePayload` (mesmo
 * `AUTH_JWT_SECRET`, sem `iss`/`aud`) seja aceito por engano aqui.
 *
 * @throws {Error} Se o token for inválido, expirado, de propósito errado, ou tiver payload incompleto.
 */
export function verifyPendingTenantSelection(token: string): PendingTenantSelectionPayload {
  const decoded = jwt.verify(token, requireJwtSecret());

  if (typeof decoded === 'string') {
    throw new Error('Token de seleção de tenant malformado.');
  }

  const { purpose, email, provider } = decoded as Partial<PendingTenantSelectionPayload>;
  if (purpose !== 'pending-tenant-selection' || !email || !provider) {
    throw new Error('Token de seleção de tenant com payload incompleto ou de propósito errado.');
  }

  return { purpose, email, provider };
}

/** Assina o access token do gestor do SaaS — mesmo TTL do token normal. Sem refresh token (ver `PlatformOperatorTokenPayload`). */
export function signPlatformOperatorToken(payload: PlatformOperatorTokenPayload): string {
  return jwt.sign(payload, requireJwtSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

/**
 * Verifica e decodifica um token de gestor do SaaS. Exige `purpose` exato,
 * mesma razão de `verifyPendingTenantSelection`.
 *
 * @throws {Error} Se o token for inválido, expirado, de propósito errado, ou tiver payload incompleto.
 */
export function verifyPlatformOperatorToken(token: string): PlatformOperatorTokenPayload {
  const decoded = jwt.verify(token, requireJwtSecret());

  if (typeof decoded === 'string') {
    throw new Error('Token de gestor do SaaS malformado.');
  }

  const { purpose, externalUserId, primaryEmail, name } = decoded as Partial<PlatformOperatorTokenPayload>;
  if (purpose !== 'platform-operator' || !externalUserId || !primaryEmail) {
    throw new Error('Token de gestor do SaaS com payload incompleto ou de propósito errado.');
  }

  return { purpose, externalUserId, primaryEmail, name };
}
