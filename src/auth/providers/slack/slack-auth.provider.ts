import { AuthProvider } from '../../core/auth-provider';
import { AuthProviderFactory } from '../../core/auth-provider.factory';
import type { ExternalIdentity } from '../../core/auth.types';

const SLACK_AUTHORIZE_URL = 'https://slack.com/openid/connect/authorize';
const SLACK_ACCESS_TOKEN_URL = 'https://slack.com/api/openid.connect.token';
const SLACK_USERINFO_URL = 'https://slack.com/api/openid.connect.userInfo';

interface SlackAccessTokenResponse {
  readonly ok: boolean;
  readonly access_token?: string;
  readonly error?: string;
}

interface SlackUserInfo {
  readonly ok: boolean;
  readonly error?: string;
  readonly sub?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly name?: string;
  readonly picture?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`[slack-auth] ${name} não está definida.`);
  }

  return value;
}

/**
 * Provider de login via "Sign in with Slack" (OpenID Connect).
 *
 * Não confundir com o fluxo clássico `oauth/v2/authorize` do Slack, usado
 * pra instalar um app/bot num workspace (escopo de bot/webhook, não de
 * identidade de pessoa) — aqui é só autenticação, endpoints OIDC próprios.
 *
 * API do Slack sempre envelopa a resposta em `ok`/`error`, mesmo com HTTP
 * 200 — por isso os dois checks (`response.ok` e `data.ok`) em cada chamada,
 * mesmo cuidado que `github-auth.provider.ts` tem ao checar `access_token`
 * mesmo com `response.ok`.
 *
 * @see .spec/spec-engineering-intelligence.md — CLAUDE.md, "Autenticação".
 */
export class SlackAuthProvider extends AuthProvider {
  readonly providerName = 'slack';

  buildAuthorizationUrl(state: string): string {
    const url = new URL(SLACK_AUTHORIZE_URL);
    url.searchParams.set('client_id', requireEnv('SLACK_OAUTH_CLIENT_ID'));
    url.searchParams.set('redirect_uri', requireEnv('SLACK_OAUTH_CALLBACK_URL'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);

    return url.toString();
  }

  async resolveIdentity(code: string): Promise<ExternalIdentity> {
    const accessToken = await this.exchangeCodeForAccessToken(code);
    const profile = await this.fetchProfile(accessToken);

    if (!profile.email || profile.email_verified !== true) {
      throw new Error('[slack-auth] Nenhum email verificado encontrado na conta do Slack.');
    }
    if (!profile.sub) {
      throw new Error('[slack-auth] Resposta do Slack sem "sub" (identificador do usuário).');
    }

    return {
      externalUserId: profile.sub,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
    };
  }

  private async exchangeCodeForAccessToken(code: string): Promise<string> {
    const response = await fetch(SLACK_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: requireEnv('SLACK_OAUTH_CLIENT_ID'),
        client_secret: requireEnv('SLACK_OAUTH_CLIENT_SECRET'),
        code,
        redirect_uri: requireEnv('SLACK_OAUTH_CALLBACK_URL'),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `[slack-auth] Falha ao trocar code por access token: ${response.status} ${response.statusText}.`,
      );
    }

    const data = (await response.json()) as SlackAccessTokenResponse;
    if (!data.ok || !data.access_token) {
      throw new Error(`[slack-auth] Slack não retornou access_token: ${data.error ?? 'motivo desconhecido'}.`);
    }

    return data.access_token;
  }

  private async fetchProfile(accessToken: string): Promise<SlackUserInfo> {
    const response = await fetch(SLACK_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`[slack-auth] GET /openid.connect.userInfo retornou ${response.status} ${response.statusText}.`);
    }

    const data = (await response.json()) as SlackUserInfo;
    if (!data.ok) {
      throw new Error(`[slack-auth] Slack não retornou o perfil: ${data.error ?? 'motivo desconhecido'}.`);
    }

    return data;
  }
}

AuthProviderFactory.register('slack', SlackAuthProvider);
