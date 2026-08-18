import { AuthProvider } from '../../core/auth-provider';
import { AuthProviderFactory } from '../../core/auth-provider.factory';
import type { ExternalIdentity } from '../../core/auth.types';

const MICROSOFT_AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_ACCESS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MICROSOFT_GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';
const MICROSOFT_SCOPE = 'openid email profile User.Read';

interface MicrosoftAccessTokenResponse {
  readonly access_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface MicrosoftGraphProfile {
  readonly id: string;
  readonly displayName: string | null;
  readonly mail: string | null;
  readonly userPrincipalName: string | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`[microsoft-auth] ${name} não está definida.`);
  }

  return value;
}

/**
 * Provider de login via Microsoft Identity Platform ("Sign in with Microsoft").
 *
 * Endpoint de tenant `common` (não um Azure AD tenant específico) — aceita
 * tanto contas pessoais quanto corporativas/escolares, coerente com um SaaS
 * multi-cliente, sem restringir a uma organização Microsoft só.
 *
 * @see .spec/spec-engineering-intelligence.md — CLAUDE.md, "Autenticação".
 */
export class MicrosoftAuthProvider extends AuthProvider {
  readonly providerName = 'microsoft';

  buildAuthorizationUrl(state: string): string {
    const url = new URL(MICROSOFT_AUTHORIZE_URL);
    url.searchParams.set('client_id', requireEnv('MICROSOFT_OAUTH_CLIENT_ID'));
    url.searchParams.set('redirect_uri', requireEnv('MICROSOFT_OAUTH_CALLBACK_URL'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', MICROSOFT_SCOPE);
    url.searchParams.set('state', state);

    return url.toString();
  }

  async resolveIdentity(code: string): Promise<ExternalIdentity> {
    const accessToken = await this.exchangeCodeForAccessToken(code);
    const profile = await this.fetchProfile(accessToken);

    // Graph `/me` não expõe um campo `email_verified` — contas Microsoft já
    // são verificadas pela própria Microsoft/TI do tenant antes de existir.
    const email = profile.mail ?? profile.userPrincipalName;
    if (!email) {
      throw new Error('[microsoft-auth] Nenhum email encontrado na conta Microsoft (nem mail, nem userPrincipalName).');
    }

    return {
      externalUserId: profile.id,
      email,
      name: profile.displayName ?? undefined,
    };
  }

  private async exchangeCodeForAccessToken(code: string): Promise<string> {
    const response = await fetch(MICROSOFT_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: requireEnv('MICROSOFT_OAUTH_CLIENT_ID'),
        client_secret: requireEnv('MICROSOFT_OAUTH_CLIENT_SECRET'),
        code,
        redirect_uri: requireEnv('MICROSOFT_OAUTH_CALLBACK_URL'),
        grant_type: 'authorization_code',
        scope: MICROSOFT_SCOPE,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `[microsoft-auth] Falha ao trocar code por access token: ${response.status} ${response.statusText}.`,
      );
    }

    const data = (await response.json()) as MicrosoftAccessTokenResponse;
    if (!data.access_token) {
      throw new Error(
        `[microsoft-auth] Microsoft não retornou access_token: ${data.error_description ?? data.error ?? 'motivo desconhecido'}.`,
      );
    }

    return data.access_token;
  }

  private async fetchProfile(accessToken: string): Promise<MicrosoftGraphProfile> {
    const response = await fetch(MICROSOFT_GRAPH_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`[microsoft-auth] GET /me retornou ${response.status} ${response.statusText}.`);
    }

    return (await response.json()) as MicrosoftGraphProfile;
  }
}

AuthProviderFactory.register('microsoft', MicrosoftAuthProvider);
