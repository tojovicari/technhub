const SLACK_API_BASE_URL = 'https://slack.com/api';

/**
 * Terceiro conceito de "Slack" no código, cada um com propósito e
 * credencial completamente diferentes — não confundir:
 *
 * 1. `src/auth/providers/slack/slack-auth.provider.ts` — "Sign in with
 *    Slack" (OIDC): autentica um usuário final na plataforma, usa
 *    `SLACK_OAUTH_CLIENT_ID`/`SECRET`.
 * 2. `src/notifications/` (`NotificationProvider`) — envio pra pessoas
 *    (email/whatsapp/sms), endereçado por contato individual.
 * 3. **Este módulo** — o backend mandando mensagem pra dentro do
 *    workspace Slack do operador da plataforma (não de um tenant, não de
 *    um usuário) — feedback recebido, eventos de billing, etc. Usa um Bot
 *    Token (`SLACK_OPS_BOT_TOKEN`) de um Slack App instalado uma vez no
 *    workspace do operador, escopos `chat:write`/`files:write`.
 *
 * Hand-rolled com `fetch()` contra a Slack Web API — mesma escolha já
 * usada nos 4 `AuthProvider` desta sessão, sem SDK novo.
 */

export interface SlackOpsResult {
  readonly success: boolean;
  readonly error?: string;
}

interface SlackApiResponse {
  readonly ok: boolean;
  readonly error?: string;
}

interface SlackUploadUrlResponse extends SlackApiResponse {
  readonly upload_url?: string;
  readonly file_id?: string;
}

export interface SlackEventNotification {
  readonly emoji: string;
  readonly title: string;
  /** Rótulo → valor, vira um bloco de "fields" lado a lado (2 colunas) no Slack. */
  readonly fields: Readonly<Record<string, string>>;
}

/**
 * Monta um cartão padrão (header + fields + timestamp) via Block Kit
 * (https://api.slack.com/block-kit) pra qualquer evento pontual — hoje só
 * usado pelos eventos de billing (`BillingService`), mas genérico o
 * bastante pra qualquer notificação estruturada futura. Devolve também um
 * `text` de fallback (obrigatório em `postMessage`, é o que aparece em
 * notificação push/busca).
 */
export function buildEventNotification(event: SlackEventNotification): { readonly text: string; readonly blocks: readonly Record<string, unknown>[] } {
  const fieldEntries = Object.entries(event.fields).filter(([, value]) => value.length > 0);

  return {
    text: `${event.emoji} ${event.title}${fieldEntries.length > 0 ? ` — ${fieldEntries.map(([, v]) => v).join(', ')}` : ''}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `${event.emoji} *${event.title}*` },
      },
      ...(fieldEntries.length > 0
        ? [
            {
              type: 'section',
              fields: fieldEntries.map(([label, value]) => ({ type: 'mrkdwn', text: `*${label}*\n${value}` })),
            },
          ]
        : []),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `:clock1: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` }],
      },
    ],
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`[slack-ops-notifier] ${name} não está definida.`);
  }

  return value;
}

export class SlackOpsNotifier {
  /**
   * Posta uma mensagem no canal. `text` é sempre obrigatório — é o que
   * aparece em notificações push/busca/preview de thread mesmo quando
   * `blocks` está presente (Slack usa `text` como fallback nesses casos,
   * nunca renderiza só a partir de `blocks`). `blocks` é o Block Kit
   * (https://api.slack.com/block-kit) pra formatação rica — opcional,
   * usado pelos eventos de billing. Nunca lança.
   */
  async postMessage(channelId: string, text: string, blocks?: readonly Record<string, unknown>[]): Promise<SlackOpsResult> {
    try {
      const response = await fetch(`${SLACK_API_BASE_URL}/chat.postMessage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${requireEnv('SLACK_OPS_BOT_TOKEN')}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ channel: channelId, text, ...(blocks ? { blocks } : {}) }),
      });

      const data = (await response.json()) as SlackApiResponse;
      if (!response.ok || !data.ok) {
        return { success: false, error: `[slack-ops-notifier] chat.postMessage falhou: ${data.error ?? response.statusText}` };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: `[slack-ops-notifier] ${(error as Error).message}` };
    }
  }

  /**
   * Posta uma mensagem com um arquivo anexado (ex: screenshot) — fluxo de
   * 2 passos da Slack Web API atual (`files.getUploadURLExternal` +
   * `files.completeUploadExternal`); a API antiga de upload num passo só
   * (`files.upload`) está deprecada. Nunca lança.
   */
  async postMessageWithFile(
    channelId: string,
    text: string,
    file: { readonly buffer: Buffer; readonly filename: string },
  ): Promise<SlackOpsResult> {
    try {
      const token = requireEnv('SLACK_OPS_BOT_TOKEN');

      const uploadUrlResponse = await fetch(`${SLACK_API_BASE_URL}/files.getUploadURLExternal`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ filename: file.filename, length: String(file.buffer.length) }),
      });
      const uploadUrlData = (await uploadUrlResponse.json()) as SlackUploadUrlResponse;
      if (!uploadUrlResponse.ok || !uploadUrlData.ok || !uploadUrlData.upload_url || !uploadUrlData.file_id) {
        return {
          success: false,
          error: `[slack-ops-notifier] files.getUploadURLExternal falhou: ${uploadUrlData.error ?? uploadUrlResponse.statusText}`,
        };
      }

      const uploadResponse = await fetch(uploadUrlData.upload_url, {
        method: 'POST',
        body: new Blob([new Uint8Array(file.buffer)]),
      });
      if (!uploadResponse.ok) {
        return { success: false, error: `[slack-ops-notifier] Upload do arquivo falhou: ${uploadResponse.statusText}` };
      }

      const completeResponse = await fetch(`${SLACK_API_BASE_URL}/files.completeUploadExternal`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          files: [{ id: uploadUrlData.file_id, title: file.filename }],
          channel_id: channelId,
          initial_comment: text,
        }),
      });
      const completeData = (await completeResponse.json()) as SlackApiResponse;
      if (!completeResponse.ok || !completeData.ok) {
        return {
          success: false,
          error: `[slack-ops-notifier] files.completeUploadExternal falhou: ${completeData.error ?? completeResponse.statusText}`,
        };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: `[slack-ops-notifier] ${(error as Error).message}` };
    }
  }
}
