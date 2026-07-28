import { BaseProvider } from './base.provider';

/** Construtor sem argumentos de uma subclasse concreta de `BaseProvider`. */
type ProviderConstructor = new () => BaseProvider;

/**
 * Registro e resolução dinâmica de conectores (`BaseProvider`) pelo
 * respectivo `providerName`.
 *
 * Mantém a Pluggable Architecture desacoplada: o `sync.orchestrator.ts` e os
 * jobs de ingestão nunca importam um provedor concreto diretamente — apenas
 * solicitam uma instância à factory pelo nome persistido em banco (ex: na
 * configuração de integração do tenant).
 *
 * Cada provedor registrado é instanciado uma única vez (singleton), já que
 * `BaseProvider` é stateless: credenciais e contexto de sincronização são
 * recebidos por chamada, não pelo construtor.
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export class ProviderFactory {
  private static readonly registry = new Map<string, ProviderConstructor>();
  private static readonly instances = new Map<string, BaseProvider>();

  private constructor() {}

  /**
   * Registra o construtor de um conector sob um `providerName` único.
   *
   * Deve ser chamado uma vez por provedor, tipicamente no bootstrap da
   * aplicação (ex: `src/integrations/index.ts`).
   *
   * @throws {Error} Quando já existe um provedor registrado sob o mesmo nome.
   */
  static register(providerName: string, providerClass: ProviderConstructor): void {
    if (ProviderFactory.registry.has(providerName)) {
      throw new Error(
        `[ProviderFactory] O provedor "${providerName}" já está registrado.`,
      );
    }

    ProviderFactory.registry.set(providerName, providerClass);
  }

  /**
   * Resolve e retorna a instância singleton do provedor solicitado.
   *
   * @throws {Error} Quando `providerName` não corresponde a nenhum provedor
   * registrado, listando os provedores atualmente disponíveis para facilitar
   * o diagnóstico.
   */
  static create(providerName: string): BaseProvider {
    const cachedInstance = ProviderFactory.instances.get(providerName);
    if (cachedInstance) {
      return cachedInstance;
    }

    const providerClass = ProviderFactory.registry.get(providerName);
    if (!providerClass) {
      const availableProviders = Array.from(ProviderFactory.registry.keys()).join(', ') || 'nenhum';
      throw new Error(
        `[ProviderFactory] Provedor "${providerName}" não está registrado. ` +
          `Provedores disponíveis: ${availableProviders}.`,
      );
    }

    const instance = new providerClass();
    ProviderFactory.instances.set(providerName, instance);
    return instance;
  }

  /** Indica se um `providerName` possui conector registrado. */
  static isRegistered(providerName: string): boolean {
    return ProviderFactory.registry.has(providerName);
  }

  /** Lista os nomes de todos os provedores atualmente registrados. */
  static listRegistered(): readonly string[] {
    return Array.from(ProviderFactory.registry.keys());
  }
}
