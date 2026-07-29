import jwt from 'jsonwebtoken';
import type { AuthTokenPayload, OAuthStatePayload, PendingTenantSelectionPayload } from './auth.types';

/** TTL curto: reduz a janela de exposição caso o access token vaze. */
const ACCESS_TOKEN_TTL = '1h';
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
 * Verifica e decodifica um access token.
 *
 * @throws {Error} Se o token for inválido, expirado ou tiver payload incompleto.
 */
export function verifyAuthToken(token: string): AuthTokenPayload {
  const decoded = jwt.verify(token, requireJwtSecret());

  if (typeof decoded === 'string') {
    throw new Error('Token de acesso malformado.');
  }

  const { userId, tenantId, systemRole, primaryEmail } = decoded as Partial<AuthTokenPayload>;
  if (!userId || !tenantId || !systemRole || !primaryEmail) {
    throw new Error('Token de acesso com payload incompleto.');
  }

  return { userId, tenantId, systemRole, primaryEmail };
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
