import type { NotificationChannel, NotificationMessage, NotificationResult } from './notification.types';

/**
 * Contrato de um provider de envio de notificações. Mesma forma de
 * `AuthProvider` (`src/auth/core/auth-provider.ts`), não de `BaseProvider`
 * (`src/integrations/core/base.provider.ts`): a credencial (ex: API key do
 * Resend) é única e global da plataforma, vinda de env var — não por
 * tenant — então não há construtor nem parâmetro de credenciais; a
 * subclasse concreta lê a env var diretamente dentro de `send`.
 *
 * `send` nunca lança — sempre devolve um `NotificationResult`, o que torna
 * o envio best-effort trivial em quem chama (sem precisar de try/catch).
 */
export abstract class NotificationProvider {
  abstract readonly providerName: string;
  abstract readonly channel: NotificationChannel;
  abstract send(message: NotificationMessage): Promise<NotificationResult>;
}
