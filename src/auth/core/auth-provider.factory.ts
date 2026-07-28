import { AuthProvider } from './auth-provider';

/** Construtor sem argumentos de uma subclasse concreta de `AuthProvider`. */
type AuthProviderConstructor = new () => AuthProvider;

/**
 * Registro e resolução dinâmica de providers de login (`AuthProvider`) pelo
 * respectivo `providerName`.
 *
 * Mesma forma do `ProviderFactory` de ingestão de dados
 * (`src/integrations/core/provider.factory.ts`), mantida como uma hierarquia
 * separada porque o contrato de `AuthProvider` é outro. Rotas HTTP nunca
 * importam um provider concreto — resolvem pelo nome via esta factory.
 */
export class AuthProviderFactory {
  private static readonly registry = new Map<string, AuthProviderConstructor>();
  private static readonly instances = new Map<string, AuthProvider>();

  private constructor() {}

  /**
   * Registra o construtor de um provider de login sob um `providerName` único.
   *
   * @throws {Error} Quando já existe um provider registrado sob o mesmo nome.
   */
  static register(providerName: string, providerClass: AuthProviderConstructor): void {
    if (AuthProviderFactory.registry.has(providerName)) {
      throw new Error(
        `[AuthProviderFactory] O provider "${providerName}" já está registrado.`,
      );
    }

    AuthProviderFactory.registry.set(providerName, providerClass);
  }

  /**
   * Resolve e retorna a instância singleton do provider de login solicitado.
   *
   * @throws {Error} Quando `providerName` não corresponde a nenhum provider
   * registrado, listando os providers disponíveis para diagnóstico.
   */
  static create(providerName: string): AuthProvider {
    const cachedInstance = AuthProviderFactory.instances.get(providerName);
    if (cachedInstance) {
      return cachedInstance;
    }

    const providerClass = AuthProviderFactory.registry.get(providerName);
    if (!providerClass) {
      const availableProviders = Array.from(AuthProviderFactory.registry.keys()).join(', ') || 'nenhum';
      throw new Error(
        `[AuthProviderFactory] Provider "${providerName}" não está registrado. ` +
          `Providers disponíveis: ${availableProviders}.`,
      );
    }

    const instance = new providerClass();
    AuthProviderFactory.instances.set(providerName, instance);
    return instance;
  }

  /** Indica se um `providerName` possui provider de login registrado. */
  static isRegistered(providerName: string): boolean {
    return AuthProviderFactory.registry.has(providerName);
  }

  /** Lista os nomes de todos os providers de login atualmente registrados. */
  static listRegistered(): readonly string[] {
    return Array.from(AuthProviderFactory.registry.keys());
  }
}
