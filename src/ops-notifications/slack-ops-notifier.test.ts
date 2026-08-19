import { afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SlackOpsNotifier } from './slack-ops-notifier';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as Response;
}

describe('SlackOpsNotifier', () => {
  before(() => {
    process.env.SLACK_OPS_BOT_TOKEN = 'xoxb-test-token';
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('postMessage monta a chamada certa e retorna sucesso', async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return jsonResponse({ ok: true });
    });

    const notifier = new SlackOpsNotifier();
    const result = await notifier.postMessage('C123', 'Olá canal');

    assert.equal(result.success, true);
    assert.equal(capturedUrl, 'https://slack.com/api/chat.postMessage');
    assert.deepEqual(capturedBody, { channel: 'C123', text: 'Olá canal' });
  });

  it('postMessage retorna erro quando a API do Slack responde ok: false', async () => {
    mock.method(globalThis, 'fetch', async () => jsonResponse({ ok: false, error: 'channel_not_found' }));

    const notifier = new SlackOpsNotifier();
    const result = await notifier.postMessage('C123', 'Olá canal');

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /channel_not_found/);
  });

  it('postMessage nunca lança mesmo com fetch quebrando', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('network down');
    });

    const notifier = new SlackOpsNotifier();
    const result = await notifier.postMessage('C123', 'Olá canal');

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /network down/);
  });

  it('postMessageWithFile encadeia os 3 passos certos e retorna sucesso', async () => {
    const calledUrls: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string) => {
      calledUrls.push(url);
      if (url === 'https://slack.com/api/files.getUploadURLExternal') {
        return jsonResponse({ ok: true, upload_url: 'https://files.slack.com/upload/abc', file_id: 'F123' });
      }
      if (url === 'https://files.slack.com/upload/abc') {
        return jsonResponse({}, true, 200);
      }
      if (url === 'https://slack.com/api/files.completeUploadExternal') {
        return jsonResponse({ ok: true });
      }
      throw new Error(`URL inesperada em teste: ${url}`);
    });

    const notifier = new SlackOpsNotifier();
    const result = await notifier.postMessageWithFile('C123', 'Feedback com print', {
      buffer: Buffer.from('fake-png-bytes'),
      filename: 'feedback.png',
    });

    assert.equal(result.success, true);
    assert.deepEqual(calledUrls, [
      'https://slack.com/api/files.getUploadURLExternal',
      'https://files.slack.com/upload/abc',
      'https://slack.com/api/files.completeUploadExternal',
    ]);
  });

  it('postMessageWithFile retorna erro se files.getUploadURLExternal falhar', async () => {
    mock.method(globalThis, 'fetch', async () => jsonResponse({ ok: false, error: 'invalid_auth' }));

    const notifier = new SlackOpsNotifier();
    const result = await notifier.postMessageWithFile('C123', 'texto', {
      buffer: Buffer.from('x'),
      filename: 'x.png',
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /invalid_auth/);
  });
});
