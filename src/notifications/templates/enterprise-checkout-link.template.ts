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
  readonly priceCents: number;
  readonly currency: string;
  readonly billingPeriod: string;
  readonly trialDays: number;
  /** `null` = ilimitado (mesma convenção de `Plan.maxUsers` etc.). */
  readonly maxUsers: number | null;
  readonly maxTeams: number | null;
  readonly maxIntegrations: number | null;
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

function formatPrice(priceCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency.toUpperCase() }).format(
      priceCents / 100,
    );
  } catch {
    // Código de moeda inesperado (não deveria acontecer — `currency` vem de `plans.currency`,
    // sempre um ISO 4217 válido nos planos cadastrados) — cai pro número cru em vez de derrubar o email.
    return `${(priceCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatBillingPeriod(billingPeriod: string): string {
  if (billingPeriod === 'annual') return '/ano';
  if (billingPeriod === 'monthly') return '/mês';
  return `/${billingPeriod}`;
}

function formatResourceLimit(label: string, limit: number | null): string {
  return limit === null ? `${label} ilimitados` : `Até ${limit} ${label.toLowerCase()}`;
}

/**
 * Só dado real já existente em `Plan` (preço, período, trial, limites) —
 * de propósito nenhum texto de feature/marketing inventado, porque não
 * existe fonte nenhuma pra isso hoje (`plans` não tem campo de descrição).
 */
function buildHighlights(input: BuildEnterpriseCheckoutLinkEmailInput): readonly string[] {
  const highlights: string[] = [
    `${formatPrice(input.priceCents, input.currency)}${formatBillingPeriod(input.billingPeriod)}`,
    formatResourceLimit('Usuários', input.maxUsers),
    formatResourceLimit('Times', input.maxTeams),
    formatResourceLimit('Integrações', input.maxIntegrations),
  ];

  if (input.trialDays > 0) {
    highlights.push(`${input.trialDays} dias de teste grátis antes da primeira cobrança`);
  }

  return highlights;
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
 * é um convite direto pra confirmar a assinatura, com os destaques reais do
 * plano (preço, período, trial, limites) pra dar contexto do que muda.
 */
export function buildEnterpriseCheckoutLinkEmailContent(
  input: BuildEnterpriseCheckoutLinkEmailInput,
): EnterpriseCheckoutLinkEmailContent {
  const safeTenant = escapeHtml(input.tenantName);
  const safePlan = escapeHtml(input.planDisplayName);
  const expiresLabel = formatExpiration(input.expiresAt);
  const highlights = buildHighlights(input);

  const subject = `Confirme seu novo plano ${input.planDisplayName} na moasy`;

  const text = [
    `Olá!`,
    '',
    `Preparamos a assinatura do plano "${input.planDisplayName}" para o workspace "${input.tenantName}" na moasy. Veja o que muda:`,
    '',
    ...highlights.map((highlight) => `- ${highlight}`),
    '',
    'Clique aqui para confirmar seu novo plano:',
    input.checkoutUrl,
    '',
    `Este link expira em ${expiresLabel} — se expirar, é só pedir um novo.`,
  ].join('\n');

  const highlightsHtml = highlights
    .map(
      (highlight) => `
                  <tr>
                    <td style="padding:6px 0; font-size:14px; line-height:1.5; color:${COLOR_FOREGROUND};">
                      <span style="color:${COLOR_PRIMARY}; font-weight:700;">&#10003;</span>
                      &nbsp;${escapeHtml(highlight)}
                    </td>
                  </tr>`,
    )
    .join('');

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
                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:${COLOR_FOREGROUND};">
                  Preparamos a assinatura do plano <strong>${safePlan}</strong> para o workspace <strong>${safeTenant}</strong> na moasy. Veja o que muda:
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                  ${highlightsHtml}
                </table>
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
