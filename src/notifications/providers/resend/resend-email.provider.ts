import { NotificationProvider } from '../../core/notification-provider';
import { NotificationProviderFactory } from '../../core/notification-provider.factory';
import type { NotificationChannel, NotificationMessage, NotificationResult } from '../../core/notification.types';

const RESEND_API_URL = 'https://api.resend.com/emails';

interface ResendResponseBody {
  readonly id?: string;
  readonly message?: string;
  readonly name?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} não está definida.`);
  }
  return value;
}

/**
 * Provider de email via Resend (https://resend.com/docs/api-reference/emails/send-email).
 *
 * Ao contrário do `requireEnv` de `github-auth.provider.ts` (que deixa
 * lançar), aqui tudo é capturado — `send()` nunca lança. Notificação é
 * best-effort por contrato do módulo: uma falha de envio nunca pode
 * propagar como exceção para quem chamou.
 */
export class ResendEmailProvider extends NotificationProvider {
  readonly providerName = 'resend';
  readonly channel: NotificationChannel = 'email';

  async send(message: NotificationMessage): Promise<NotificationResult> {
    if (message.channel !== 'email') {
      return { success: false, error: `[resend-email] Canal "${message.channel}" não suportado por este provider.` };
    }

    try {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: requireEnv('RESEND_FROM_EMAIL'),
          to: message.to.map((recipient) => recipient.address),
          subject: message.subject ?? '',
          html: message.bodyHtml,
          text: message.bodyText,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as ResendResponseBody;

      if (!response.ok) {
        return {
          success: false,
          error: `[resend-email] ${response.status} ${response.statusText}: ${data.message ?? 'erro desconhecido'}`,
        };
      }

      return { success: true, providerMessageId: data.id };
    } catch (error) {
      return { success: false, error: `[resend-email] ${(error as Error).message}` };
    }
  }
}

NotificationProviderFactory.register('resend', ResendEmailProvider);
