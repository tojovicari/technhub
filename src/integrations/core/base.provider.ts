import type {
  ProviderCategory,
  ProviderCredentials,
  SyncContext,
  SyncResult,
} from './canonical.types';

/**
 * Contrato base para todos os conectores de ingestão (Pluggable Architecture).
 *
 * O core da aplicação interage exclusivamente com este contrato — nunca com
 * SDKs ou clientes HTTP específicos de um provedor. Cada novo conector
 * (GitHub, Jira, Linear, Incident.io, Slack, etc.) deve estender esta classe
 * e implementar a tradução do seu payload nativo para a Camada Canônica
 * (`canonical.types.ts`).
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export abstract class BaseProvider {
  /** Identificador único e estável do provedor (ex: 'github', 'jira'). */
  abstract readonly providerName: string;

  /** Categoria de origem do provedor, conforme a Matriz de Cobertura (Seção 2). */
  abstract readonly category: ProviderCategory;

  /**
   * Valida se as credenciais fornecidas permitem autenticação no provedor
   * remoto, sem executar nenhuma sincronização de dados.
   */
  abstract testConnection(
    credentials: ProviderCredentials,
  ): Promise<{ success: boolean; message?: string }>;

  /**
   * Executa uma sincronização incremental (batch), retornando os lotes
   * canônicos coletados e o cursor a ser reutilizado na próxima execução.
   */
  abstract syncIncremental(context: SyncContext): Promise<SyncResult>;

  /**
   * Garante que todos os campos obrigatórios de `ProviderCredentials` para
   * este provedor estejam presentes antes de uma chamada remota.
   *
   * Deve ser chamado no início de `testConnection`/`syncIncremental` pelas
   * subclasses, informando quais chaves de `ProviderCredentials` a
   * integração exige (ex: `['apiToken', 'baseUrl']` para Jira Server).
   *
   * @throws {Error} Quando alguma credencial obrigatória está ausente,
   * identificando o provedor e o(s) campo(s) faltante(s).
   */
  protected validateRequiredCredentials(
    credentials: ProviderCredentials,
    requiredFields: readonly (keyof ProviderCredentials)[],
  ): void {
    const missingFields = requiredFields.filter(
      (field) => credentials[field] === undefined || credentials[field] === '',
    );

    if (missingFields.length > 0) {
      throw new Error(
        `[${this.providerName}] Credenciais obrigatórias ausentes: ${missingFields.join(', ')}.`,
      );
    }
  }
}
