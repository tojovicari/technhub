/**
 * Prefixo das rotas do gestor do SaaS (`admin.routes.ts`) — não-óbvio de
 * propósito (nunca `/admin`, `/ops`, `/internal`), pra não ser um alvo fácil
 * de scanner/bot batendo em caminhos comuns. `PLATFORM_ADMIN_ROUTE_PREFIX`
 * não tem valor default: se não configurado, as rotas simplesmente não
 * existem (falha fechada) — melhor que cair num default adivinhável.
 */
export function getPlatformAdminRoutePrefix(): string | undefined {
  return process.env.PLATFORM_ADMIN_ROUTE_PREFIX;
}
