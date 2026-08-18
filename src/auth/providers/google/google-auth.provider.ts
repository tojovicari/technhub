import { AuthProvider } from '../../core/auth-provider';
import { AuthProviderFactory } from '../../core/auth-provider.factory';
import type { ExternalIdentity } from '../../core/auth.types';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_ACCESS_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

interface GoogleAccessTokenResponse {
  readonly access_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface GoogleUserInfo {
  readonly sub: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly name?: string;
  readonly picture?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`[google-auth] ${name} não está definida.`);
  }

  return value;
}

/**
 * Provider de login via Google OAuth2/OIDC ("Sign in with Google").
 *
 * @see .spec/spec-engineering-intelligence.md — CLAUDE.md, "Autenticação".
 */
export class GoogleAuthProvider extends AuthProvider {
  readonly providerName = 'google';

  buildAuthorizationUrl(state: string): string {
    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.searchParams.set('client_id', requireEnv('GOOGLE_OAUTH_CLIENT_ID'));
    url.searchParams.set('redirect_uri', requireEnv('GOOGLE_OAUTH_CALLBACK_URL'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    // Não precisamos do refresh token do Google — já emitimos refresh token próprio.
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('state', state);

    return url.toString();
  }

  async resolveIdentity(code: string): Promise<ExternalIdentity> {
    const accessToken = await this.exchangeCodeForAccessToken(code);
    const profile = await this.fetchProfile(accessToken);

    if (!profile.email || profile.email_verified !== true) {
      throw new Error('[google-auth] Nenhum email verificado encontrado na conta do Google.');
    }

    return {
      externalUserId: profile.sub,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
    };
  }

  private async exchangeCodeForAccessToken(code: string): Promise<string> {
    const response = await fetch(GOOGLE_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: requireEnv('GOOGLE_OAUTH_CLIENT_ID'),
        client_secret: requireEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
        code,
        redirect_uri: requireEnv('GOOGLE_OAUTH_CALLBACK_URL'),
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      throw new Error(
        `[google-auth] Falha ao trocar code por access token: ${response.status} ${response.statusText}.`,
      );
    }

    const data = (await response.json()) as GoogleAccessTokenResponse;
    if (!data.access_token) {
      throw new Error(
        `[google-auth] Google não retornou access_token: ${data.error_description ?? data.error ?? 'motivo desconhecido'}.`,
      );
    }

    return data.access_token;
  }

  private async fetchProfile(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`[google-auth] GET /userinfo retornou ${response.status} ${response.statusText}.`);
    }

    return (await response.json()) as GoogleUserInfo;
  }
}

AuthProviderFactory.register('google', GoogleAuthProvider);
