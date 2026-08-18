import { afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SlackAuthProvider } from './slack-auth.provider';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as Response;
}

describe('SlackAuthProvider', () => {
  before(() => {
    process.env.SLACK_OAUTH_CLIENT_ID = 'client-id';
    process.env.SLACK_OAUTH_CLIENT_SECRET = 'client-secret';
    process.env.SLACK_OAUTH_CALLBACK_URL = 'http://127.0.0.1:3000/auth/slack/callback';
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('monta a URL de autorização (OIDC) com client_id/redirect_uri/scope/state', () => {
    const provider = new SlackAuthProvider();
    const url = new URL(provider.buildAuthorizationUrl('signed-state'));

    assert.equal(url.origin + url.pathname, 'https://slack.com/openid/connect/authorize');
    assert.equal(url.searchParams.get('client_id'), 'client-id');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:3000/auth/slack/callback');
    assert.equal(url.searchParams.get('scope'), 'openid email profile');
    assert.equal(url.searchParams.get('state'), 'signed-state');
  });

  it('resolveIdentity mapeia uma resposta de sucesso pro ExternalIdentity esperado', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('openid.connect.token')) {
        return jsonResponse({ ok: true, access_token: 'slack_token' });
      }
      if (url.includes('openid.connect.userInfo')) {
        return jsonResponse({
          ok: true,
          sub: 'U012ABC3DEF',
          email: 'dev@example.com',
          email_verified: true,
          name: 'Dev Exemplo',
          picture: 'https://example.com/avatar.png',
        });
      }
      throw new Error(`URL inesperada em teste: ${url}`);
    });

    const provider = new SlackAuthProvider();
    const identity = await provider.resolveIdentity('some-code');

    assert.deepEqual(identity, {
      externalUserId: 'U012ABC3DEF',
      email: 'dev@example.com',
      name: 'Dev Exemplo',
      avatarUrl: 'https://example.com/avatar.png',
    });
  });

  it('resolveIdentity lança erro quando o Slack retorna ok: false no token exchange', async () => {
    mock.method(globalThis, 'fetch', async () => jsonResponse({ ok: false, error: 'invalid_code' }));

    const provider = new SlackAuthProvider();
    await assert.rejects(() => provider.resolveIdentity('bad-code'), /Slack não retornou access_token/);
  });

  it('resolveIdentity lança erro quando o email não vem verificado', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('openid.connect.token')) {
        return jsonResponse({ ok: true, access_token: 'slack_token' });
      }
      return jsonResponse({ ok: true, sub: 'U012ABC3DEF', email: 'dev@example.com', email_verified: false });
    });

    const provider = new SlackAuthProvider();
    await assert.rejects(() => provider.resolveIdentity('some-code'), /email verificado/);
  });
});
