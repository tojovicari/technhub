export interface InviteEmailContent {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface BuildInviteEmailInput {
  readonly recipientName: string;
  readonly loginUrl: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
  );
}

/**
 * Conteúdo do email de convite de usuário — a única peça do módulo de
 * notificações que conhece copy de produto. `core/` e `providers/`
 * permanecem genéricos e reutilizáveis por qualquer chamador futuro.
 */
export function buildInviteEmailContent(input: BuildInviteEmailInput): InviteEmailContent {
  const subject = 'Você foi convidado para a plataforma';

  const text = [
    `Olá, ${input.recipientName}!`,
    '',
    'Você foi convidado a acessar a plataforma de Engineering Intelligence.',
    'Entre pelo link abaixo:',
    input.loginUrl,
    '',
    'Se você não esperava este convite, ignore este email.',
  ].join('\n');

  const html = `
    <p>Olá, ${escapeHtml(input.recipientName)}!</p>
    <p>Você foi convidado a acessar a plataforma de Engineering Intelligence.</p>
    <p><a href="${input.loginUrl}">Clique aqui para entrar</a></p>
    <p>Se você não esperava este convite, ignore este email.</p>
  `.trim();

  return { subject, html, text };
}
