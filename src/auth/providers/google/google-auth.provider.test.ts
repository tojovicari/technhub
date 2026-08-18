import { afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAuthProvider } from './google-auth.provider';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as Response;
}

describe('GoogleAuthProvider', () => {
  before(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_OAUTH_CALLBACK_URL = 'http://127.0.0.1:3000/auth/google/callback';
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('monta a URL de autorização com client_id/redirect_uri/scope/state', () => {
    const provider = new GoogleAuthProvider();
    const url = new URL(provider.buildAuthorizationUrl('signed-state'));

    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('client_id'), 'client-id');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:3000/auth/google/callback');
    assert.equal(url.searchParams.get('scope'), 'openid email profile');
    assert.equal(url.searchParams.get('state'), 'signed-state');
  });

  it('resolveIdentity mapeia uma resposta de sucesso pro ExternalIdentity esperado', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'gho_token' });
      }
      if (url.includes('openidconnect.googleapis.com/v1/userinfo')) {
        return jsonResponse({
          sub: '12345',
          email: 'dev@example.com',
          email_verified: true,
          name: 'Dev Exemplo',
          picture: 'https://example.com/avatar.png',
        });
      }
      throw new Error(`URL inesperada em teste: ${url}`);
    });

    const provider = new GoogleAuthProvider();
    const identity = await provider.resolveIdentity('some-code');

    assert.deepEqual(identity, {
      externalUserId: '12345',
      email: 'dev@example.com',
      name: 'Dev Exemplo',
      avatarUrl: 'https://example.com/avatar.png',
    });
  });

  it('resolveIdentity lança erro quando o token exchange falha', async () => {
    mock.method(globalThis, 'fetch', async () => jsonResponse({ error: 'invalid_grant' }, false, 400));

    const provider = new GoogleAuthProvider();
    await assert.rejects(() => provider.resolveIdentity('bad-code'), /Falha ao trocar code por access token/);
  });

  it('resolveIdentity lança erro quando o email não vem verificado', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'gho_token' });
      }
      return jsonResponse({ sub: '12345', email: 'dev@example.com', email_verified: false });
    });

    const provider = new GoogleAuthProvider();
    await assert.rejects(() => provider.resolveIdentity('some-code'), /email verificado/);
  });
});
