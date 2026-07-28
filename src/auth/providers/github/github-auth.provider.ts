import { AuthProvider } from '../../core/auth-provider';
import { AuthProviderFactory } from '../../core/auth-provider.factory';
import type { ExternalIdentity } from '../../core/auth.types';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_BASE_URL = 'https://api.github.com';

interface GitHubAccessTokenResponse {
  readonly access_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface GitHubUserProfile {
  readonly id: number;
  readonly login: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly avatar_url: string | null;
}

interface GitHubEmail {
  readonly email: string;
  readonly primary: boolean;
  readonly verified: boolean;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`[github-auth] ${name} não está definida.`);
  }

  return value;
}

/**
 * Provider de login via GitHub OAuth2 ("Sign in with GitHub").
 *
 * Não confundir com `GitHubProvider` de `src/integrations/providers/github/` —
 * aquele sincroniza dados de um tenant (PAT fine-grained por integração);
 * este autentica uma pessoa (OAuth App único da plataforma).
 *
 * @see .spec/spec-engineering-intelligence.md — CLAUDE.md, "Autenticação".
 */
export class GitHubAuthProvider extends AuthProvider {
  readonly providerName = 'github';

  buildAuthorizationUrl(state: string): string {
    const url = new URL(GITHUB_AUTHORIZE_URL);
    url.searchParams.set('client_id', requireEnv('GITHUB_OAUTH_CLIENT_ID'));
    url.searchParams.set('redirect_uri', requireEnv('GITHUB_OAUTH_CALLBACK_URL'));
    url.searchParams.set('scope', 'read:user user:email');
    url.searchParams.set('state', state);

    return url.toString();
  }

  async resolveIdentity(code: string): Promise<ExternalIdentity> {
    const accessToken = await this.exchangeCodeForAccessToken(code);
    const profile = await this.fetchProfile(accessToken);
    const email = profile.email ?? (await this.fetchPrimaryEmail(accessToken));

    return {
      externalUserId: String(profile.id),
      email,
      name: profile.name ?? profile.login,
      avatarUrl: profile.avatar_url ?? undefined,
    };
  }

  private async exchangeCodeForAccessToken(code: string): Promise<string> {
    const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: requireEnv('GITHUB_OAUTH_CLIENT_ID'),
        client_secret: requireEnv('GITHUB_OAUTH_CLIENT_SECRET'),
        code,
        redirect_uri: requireEnv('GITHUB_OAUTH_CALLBACK_URL'),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `[github-auth] Falha ao trocar code por access token: ${response.status} ${response.statusText}.`,
      );
    }

    const data = (await response.json()) as GitHubAccessTokenResponse;
    if (!data.access_token) {
      throw new Error(
        `[github-auth] GitHub não retornou access_token: ${data.error_description ?? data.error ?? 'motivo desconhecido'}.`,
      );
    }

    return data.access_token;
  }

  private async fetchProfile(accessToken: string): Promise<GitHubUserProfile> {
    const response = await fetch(`${GITHUB_API_BASE_URL}/user`, {
      headers: this.buildHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(`[github-auth] GET /user retornou ${response.status} ${response.statusText}.`);
    }

    return (await response.json()) as GitHubUserProfile;
  }

  /** Chamado quando o email primário não é público — GitHub exige /user/emails nesse caso. */
  private async fetchPrimaryEmail(accessToken: string): Promise<string> {
    const response = await fetch(`${GITHUB_API_BASE_URL}/user/emails`, {
      headers: this.buildHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(`[github-auth] GET /user/emails retornou ${response.status} ${response.statusText}.`);
    }

    const emails = (await response.json()) as readonly GitHubEmail[];
    const primary = emails.find((entry) => entry.primary && entry.verified) ?? emails.find((entry) => entry.verified);

    if (!primary) {
      throw new Error('[github-auth] Nenhum email verificado encontrado na conta do GitHub.');
    }

    return primary.email;
  }

  private buildHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}

AuthProviderFactory.register('github', GitHubAuthProvider);
