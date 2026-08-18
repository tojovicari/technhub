import { afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MicrosoftAuthProvider } from './microsoft-auth.provider';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as Response;
}

describe('MicrosoftAuthProvider', () => {
  before(() => {
    process.env.MICROSOFT_OAUTH_CLIENT_ID = 'client-id';
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'client-secret';
    process.env.MICROSOFT_OAUTH_CALLBACK_URL = 'http://127.0.0.1:3000/auth/microsoft/callback';
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('monta a URL de autorização com client_id/redirect_uri/scope/state no tenant common', () => {
    const provider = new MicrosoftAuthProvider();
    const url = new URL(provider.buildAuthorizationUrl('signed-state'));

    assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    assert.equal(url.searchParams.get('client_id'), 'client-id');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:3000/auth/microsoft/callback');
    assert.equal(url.searchParams.get('scope'), 'openid email profile User.Read');
    assert.equal(url.searchParams.get('state'), 'signed-state');
  });

  it('resolveIdentity usa "mail" quando presente', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('login.microsoftonline.com')) {
        return jsonResponse({ access_token: 'graph_token' });
      }
      return jsonResponse({
        id: 'abc-123',
        displayName: 'Dev Exemplo',
        mail: 'dev@example.com',
        userPrincipalName: 'dev@example.onmicrosoft.com',
      });
    });

    const provider = new MicrosoftAuthProvider();
    const identity = await provider.resolveIdentity('some-code');

    assert.deepEqual(identity, {
      externalUserId: 'abc-123',
      email: 'dev@example.com',
      name: 'Dev Exemplo',
    });
  });

  it('resolveIdentity cai pra "userPrincipalName" quando "mail" é null', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('login.microsoftonline.com')) {
        return jsonResponse({ access_token: 'graph_token' });
      }
      return jsonResponse({
        id: 'abc-123',
        displayName: 'Dev Exemplo',
        mail: null,
        userPrincipalName: 'dev@example.onmicrosoft.com',
      });
    });

    const provider = new MicrosoftAuthProvider();
    const identity = await provider.resolveIdentity('some-code');

    assert.equal(identity.email, 'dev@example.onmicrosoft.com');
  });

  it('resolveIdentity lança erro quando o token exchange falha', async () => {
    mock.method(globalThis, 'fetch', async () => jsonResponse({ error: 'invalid_grant' }, false, 400));

    const provider = new MicrosoftAuthProvider();
    await assert.rejects(() => provider.resolveIdentity('bad-code'), /Falha ao trocar code por access token/);
  });
});
