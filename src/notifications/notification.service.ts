import { NotificationProviderFactory } from './core/notification-provider.factory';
import type { NotificationMessage, NotificationRecipient, NotificationResult } from './core/notification.types';
import { buildInviteEmailContent } from './templates/invite-email.template';
import { buildEnterpriseCheckoutLinkEmailContent } from './templates/enterprise-checkout-link.template';

const DEFAULT_EMAIL_PROVIDER = 'resend';

export interface SendEmailInput {
  readonly to: readonly NotificationRecipient[];
  readonly subject: string;
  readonly html?: string;
  readonly text?: string;
}

export interface SendInviteEmailInput {
  readonly to: string;
  readonly recipientName: string;
  readonly tenantName: string;
  readonly loginUrl: string;
}

export interface SendEnterpriseCheckoutLinkEmailInput {
  readonly to: string;
  readonly tenantName: string;
  readonly planDisplayName: string;
  readonly checkoutUrl: string;
  readonly expiresAt: Date;
}

/**
 * Fachada do módulo de notificações. Chamadores (rotas HTTP, jobs, etc.)
 * nunca importam um `NotificationProvider` concreto — só conversam com este
 * serviço, que resolve o provider ativo via `NotificationProviderFactory`.
 * Trocar de ferramenta de email = mudar `NOTIFICATION_EMAIL_PROVIDER`, sem
 * tocar nenhum código chamador (mesmo princípio de `AuthProviderFactory`
 * resolvido por nome nas rotas de `/auth/:provider/...`).
 */
export class NotificationService {
  constructor(
    private readonly emailProviderName: string = process.env.NOTIFICATION_EMAIL_PROVIDER ?? DEFAULT_EMAIL_PROVIDER,
  ) {}

  async sendEmail(input: SendEmailInput): Promise<NotificationResult> {
    const provider = NotificationProviderFactory.create(this.emailProviderName);
    const message: NotificationMessage = {
      channel: 'email',
      to: input.to,
      subject: input.subject,
      bodyHtml: input.html,
      bodyText: input.text,
    };
    return provider.send(message);
  }

  /** Conveniência de alto nível para o fluxo de convite — delega a copy a `templates/invite-email.template.ts`. */
  async sendInviteEmail(input: SendInviteEmailInput): Promise<NotificationResult> {
    const content = buildInviteEmailContent({
      recipientName: input.recipientName,
      tenantName: input.tenantName,
      loginUrl: input.loginUrl,
    });

    return this.sendEmail({
      to: [{ address: input.to, name: input.recipientName }],
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
  }

  /** Conveniência de alto nível para o link de checkout enterprise — delega a copy a `templates/enterprise-checkout-link.template.ts`. */
  async sendEnterpriseCheckoutLinkEmail(input: SendEnterpriseCheckoutLinkEmailInput): Promise<NotificationResult> {
    const content = buildEnterpriseCheckoutLinkEmailContent({
      tenantName: input.tenantName,
      planDisplayName: input.planDisplayName,
      checkoutUrl: input.checkoutUrl,
      expiresAt: input.expiresAt,
    });

    return this.sendEmail({
      to: [{ address: input.to }],
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
  }
}
