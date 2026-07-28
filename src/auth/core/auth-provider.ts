import type { ExternalIdentity } from './auth.types';

/**
 * Contrato para todo provider de login (OAuth2/SSO).
 *
 * Análogo ao `BaseProvider` de ingestão de dados (`src/integrations/core/base.provider.ts`),
 * mas com um contrato diferente: aqui o objetivo não é sincronizar dados, é
 * resolver "quem é essa pessoa" a partir de um `code` de autorização.
 *
 * Novos providers (Slack, Teams, Jira, ...) implementam esta classe e se
 * registram no `AuthProviderFactory` — nenhuma rota HTTP precisa mudar.
 */
export abstract class AuthProvider {
  /** Identificador único do provider (ex: 'github', 'slack'). */
  abstract readonly providerName: string;

  /** Monta a URL de autorização do provider, incluindo o `state` assinado. */
  abstract buildAuthorizationUrl(state: string): string;

  /** Troca o `code` de autorização por uma identidade externa normalizada. */
  abstract resolveIdentity(code: string): Promise<ExternalIdentity>;
}
