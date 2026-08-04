export interface InviteEmailContent {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface BuildInviteEmailInput {
  readonly recipientName: string;
  readonly tenantName: string;
  readonly loginUrl: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
  );
}

/**
 * Paleta/fonte extraídas de `n_front/front/src/index.css` (`--primary`,
 * `--foreground`, etc. do tema claro — email não tem como respeitar o dark
 * mode do destinatário de forma confiável, então usa sempre o claro) e
 * `src/components/Logo.tsx` (wordmark oficial). Fonte com fallback de
 * sistema, não `@import` — a maioria dos clientes de email não carrega
 * fontes externas.
 */
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
 * Conteúdo do email de convite de usuário — a única peça do módulo de
 * notificações que conhece copy de produto. `core/` e `providers/`
 * permanecem genéricos e reutilizáveis por qualquer chamador futuro.
 */
export function buildInviteEmailContent(input: BuildInviteEmailInput): InviteEmailContent {
  const safeName = escapeHtml(input.recipientName);
  const safeTenant = escapeHtml(input.tenantName);

  const subject = `Convite para o workspace ${input.tenantName} na moasy`;

  const text = [
    `Olá, ${input.recipientName}!`,
    '',
    `Você foi convidado a entrar no workspace "${input.tenantName}" na moasy, a plataforma de Engineering Governance da sua equipe.`,
    '',
    'Aceite o convite pelo link abaixo (entrada via GitHub):',
    input.loginUrl,
    '',
    'Se você não esperava este convite, pode ignorar este email com segurança — nenhuma conta é criada até o link ser aberto.',
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
                  Olá, ${safeName}!
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:${COLOR_FOREGROUND};">
                  Você foi convidado a entrar no workspace <strong>${safeTenant}</strong> na moasy, a plataforma de Engineering Governance da sua equipe — DORA, Flow e SPACE Metrics num lugar só.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="border-radius:8px; background-color:${COLOR_PRIMARY};">
                      <a href="${input.loginUrl}"
                         style="display:inline-block; padding:12px 24px; font-size:15px; font-weight:600; color:${COLOR_PRIMARY_FOREGROUND}; text-decoration:none; border-radius:8px;">
                        Aceitar convite com GitHub
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0; font-size:13px; line-height:1.5; color:${COLOR_MUTED_FOREGROUND};">
                  Se você não esperava este convite, pode ignorar este email com segurança — nenhuma conta é criada até o link ser aberto.
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
