import { NotificationProvider } from './notification-provider';

/** Construtor sem argumentos de uma subclasse concreta de `NotificationProvider`. */
type NotificationProviderConstructor = new () => NotificationProvider;

/**
 * Registro e resolução dinâmica de providers de notificação pelo respectivo
 * `providerName`.
 *
 * Mesma forma de `AuthProviderFactory` (`src/auth/core/auth-provider.factory.ts`),
 * mantida como hierarquia separada porque o contrato de `NotificationProvider`
 * é outro. Chamadores nunca importam um provider concreto — resolvem pelo
 * nome (tipicamente vindo de env var, ver `NotificationService`), o que é o
 * ponto de troca de ferramenta sem acoplamento.
 */
export class NotificationProviderFactory {
  private static readonly registry = new Map<string, NotificationProviderConstructor>();
  private static readonly instances = new Map<string, NotificationProvider>();

  private constructor() {}

  /**
   * Registra o construtor de um provider de notificação sob um `providerName` único.
   *
   * @throws {Error} Quando já existe um provider registrado sob o mesmo nome.
   */
  static register(providerName: string, providerClass: NotificationProviderConstructor): void {
    if (NotificationProviderFactory.registry.has(providerName)) {
      throw new Error(`[NotificationProviderFactory] O provider "${providerName}" já está registrado.`);
    }

    NotificationProviderFactory.registry.set(providerName, providerClass);
  }

  /**
   * Resolve e retorna a instância singleton do provider de notificação solicitado.
   *
   * @throws {Error} Quando `providerName` não corresponde a nenhum provider
   * registrado, listando os providers disponíveis para diagnóstico.
   */
  static create(providerName: string): NotificationProvider {
    const cachedInstance = NotificationProviderFactory.instances.get(providerName);
    if (cachedInstance) {
      return cachedInstance;
    }

    const providerClass = NotificationProviderFactory.registry.get(providerName);
    if (!providerClass) {
      const availableProviders = Array.from(NotificationProviderFactory.registry.keys()).join(', ') || 'nenhum';
      throw new Error(
        `[NotificationProviderFactory] Provider "${providerName}" não está registrado. ` +
          `Providers disponíveis: ${availableProviders}.`,
      );
    }

    const instance = new providerClass();
    NotificationProviderFactory.instances.set(providerName, instance);
    return instance;
  }

  /** Indica se um `providerName` possui provider de notificação registrado. */
  static isRegistered(providerName: string): boolean {
    return NotificationProviderFactory.registry.has(providerName);
  }

  /** Lista os nomes de todos os providers de notificação atualmente registrados. */
  static listRegistered(): readonly string[] {
    return Array.from(NotificationProviderFactory.registry.keys());
  }
}
