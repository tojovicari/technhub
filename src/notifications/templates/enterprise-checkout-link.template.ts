export interface EnterpriseCheckoutLinkEmailContent {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface BuildEnterpriseCheckoutLinkEmailInput {
  readonly tenantName: string;
  readonly planDisplayName: string;
  readonly checkoutUrl: string;
  readonly expiresAt: Date;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
  );
}

function formatExpiration(expiresAt: Date): string {
  return expiresAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Mesma paleta/fonte de `invite-email.template.ts` — ver comentário lá sobre a origem dos valores. */
const COLOR_PRIMARY = '#06b6d4';
const COLOR_PRIMARY_FOREGROUND = '#082f39';
const COLOR_FOREGROUND = '#0c1117';
const COLOR_MUTED_FOREGROUND = '#64748b';
const COLOR_BORDER = '#e2e8f0';
const COLOR_BACKGROUND = '#f8fafc';
const COLOR_CARD = '#ffffff';
const FONT_SANS =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_MONO = "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

/**
 * Conteúdo do email de link de checkout enterprise (gerado pelo gestor do
 * SaaS em `admin.routes.ts`, ver `BillingService.createEnterpriseCheckoutLink`).
 * Copy pensada com chamada de ação explícita — não é "aqui está seu link",
 * é um convite direto pra confirmar a assinatura.
 */
export function buildEnterpriseCheckoutLinkEmailContent(
  input: BuildEnterpriseCheckoutLinkEmailInput,
): EnterpriseCheckoutLinkEmailContent {
  const safeTenant = escapeHtml(input.tenantName);
  const safePlan = escapeHtml(input.planDisplayName);
  const expiresLabel = formatExpiration(input.expiresAt);

  const subject = `Confirme seu novo plano ${input.planDisplayName} na moasy`;

  const text = [
    `Olá!`,
    '',
    `Preparamos a assinatura do plano "${input.planDisplayName}" para o workspace "${input.tenantName}" na moasy.`,
    '',
    'Clique aqui para confirmar seu novo plano:',
    input.checkoutUrl,
    '',
    `Este link expira em ${expiresLabel} — se expirar, é só pedir um novo.`,
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0; padding:32px 16px; background-color:${COLOR_BACKGROUND}; font-family:${FONT_SANS};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px; width:100%;">
            <tr>
              <td style="padding-bottom:24px;">
                <span style="font-family:${FONT_SANS}; font-weight:600; font-size:22px; letter-spacing:-0.5px; color:${COLOR_FOREGROUND};">
                  moas<span style="color:${COLOR_PRIMARY};">y</span>
                </span>
                <div style="font-family:${FONT_MONO}; font-size:10px; letter-spacing:2px; color:${COLOR_MUTED_FOREGROUND}; margin-top:2px;">
                  ENGINEERING GOVERNANCE
                </div>
              </td>
            </tr>
            <tr>
              <td style="background-color:${COLOR_CARD}; border:1px solid ${COLOR_BORDER}; border-radius:12px; padding:32px;">
                <p style="margin:0 0 16px; font-size:16px; line-height:1.5; color:${COLOR_FOREGROUND};">
                  Olá!
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:${COLOR_FOREGROUND};">
                  Preparamos a assinatura do plano <strong>${safePlan}</strong> para o workspace <strong>${safeTenant}</strong> na moasy.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="border-radius:8px; background-color:${COLOR_PRIMARY};">
                      <a href="${input.checkoutUrl}"
                         style="display:inline-block; padding:12px 24px; font-size:15px; font-weight:600; color:${COLOR_PRIMARY_FOREGROUND}; text-decoration:none; border-radius:8px;">
                        Clique aqui para confirmar seu novo plano
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0; font-size:13px; line-height:1.5; color:${COLOR_MUTED_FOREGROUND};">
                  Este link expira em ${expiresLabel} — se expirar, basta pedir um novo.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  return { subject, html, text };
}
