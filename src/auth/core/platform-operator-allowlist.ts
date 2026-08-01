/**
 * Allowlist do gestor do SaaS (platform operator) — não é um `systemRole`
 * dentro de `users`, é um mecanismo separado de propósito (ver
 * `PlatformOperatorTokenPayload`). `PLATFORM_OPERATOR_GITHUB_IDS` guarda os
 * IDs numéricos e estáveis do GitHub (não o username, que pode mudar),
 * separados por vírgula.
 */
export function isPlatformOperator(externalUserId: string): boolean {
  const allowlist = (process.env.PLATFORM_OPERATOR_GITHUB_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return allowlist.includes(externalUserId);
}
