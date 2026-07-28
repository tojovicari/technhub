import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationProvider } from './notification-provider';
import { NotificationProviderFactory } from './notification-provider.factory';
import type { NotificationChannel, NotificationMessage, NotificationResult } from './notification.types';

class FakeEmailProvider extends NotificationProvider {
  readonly providerName = 'fake-test-provider';
  readonly channel: NotificationChannel = 'email';

  async send(_message: NotificationMessage): Promise<NotificationResult> {
    return { success: true, providerMessageId: 'fake-id' };
  }
}

NotificationProviderFactory.register('fake-test-provider', FakeEmailProvider);

describe('NotificationProviderFactory', () => {
  it('resolve a mesma instância (singleton) em chamadas repetidas', () => {
    const first = NotificationProviderFactory.create('fake-test-provider');
    const second = NotificationProviderFactory.create('fake-test-provider');
    assert.equal(first, second);
  });

  it('lança ao registrar um providerName duplicado', () => {
    assert.throws(() => NotificationProviderFactory.register('fake-test-provider', FakeEmailProvider));
  });

  it('lança ao pedir um provider não registrado', () => {
    assert.throws(() => NotificationProviderFactory.create('nao-existe'));
  });

  it('isRegistered/listRegistered refletem o registro', () => {
    assert.equal(NotificationProviderFactory.isRegistered('fake-test-provider'), true);
    assert.ok(NotificationProviderFactory.listRegistered().includes('fake-test-provider'));
  });
});
