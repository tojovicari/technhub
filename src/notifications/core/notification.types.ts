/**
 * Módulo de Envio de Notificações (email hoje, WhatsApp/SMS depois) — envio
 * de saída (outbound) para pessoas, desacoplado da ferramenta concreta.
 *
 * Não confundir com `CommunicationProvider` de
 * `src/integrations/core/canonical.types.ts` — aquele modela ingestão de
 * dados de chat (Slack/Teams) para métricas SPACE; este módulo é sobre
 * enviar mensagens (convite, alertas, etc.), um domínio completamente
 * diferente. Por isso os nomes aqui são deliberadamente distintos.
 */

/** Canal de envio. Um novo canal (whatsapp, sms) só exige um novo valor aqui + um novo provider. */
export type NotificationChannel = 'email' | 'whatsapp' | 'sms';

/** Destinatário — `address` é interpretado conforme o canal (email, telefone E.164, etc.). */
export interface NotificationRecipient {
  readonly address: string;
  readonly name?: string;
}

/**
 * Envelope genérico de uma mensagem. Campos de email (`subject`, `bodyHtml`)
 * são ignorados por canais que não os usam. `metadata` cobre extensões
 * específicas de canal (ex: nome de template do WhatsApp Business API) sem
 * sujar o contrato genérico.
 */
export interface NotificationMessage {
  readonly channel: NotificationChannel;
  readonly to: readonly NotificationRecipient[];
  readonly subject?: string;
  readonly bodyText?: string;
  readonly bodyHtml?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Resultado de uma tentativa de envio — o contrato nunca lança, sempre retorna isto. */
export interface NotificationResult {
  readonly success: boolean;
  readonly providerMessageId?: string;
  readonly error?: string;
}
