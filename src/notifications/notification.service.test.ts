import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationService } from './notification.service';
import { NotificationProvider } from './core/notification-provider';
import { NotificationProviderFactory } from './core/notification-provider.factory';
import type { NotificationChannel, NotificationMessage, NotificationResult } from './core/notification.types';

class CapturingProvider extends NotificationProvider {
  readonly providerName = 'fake-capture';
  readonly channel: NotificationChannel = 'email';
  lastMessage?: NotificationMessage;

  async send(message: NotificationMessage): Promise<NotificationResult> {
    this.lastMessage = message;
    return { success: true, providerMessageId: 'captured' };
  }
}

NotificationProviderFactory.register('fake-capture', CapturingProvider);

describe('NotificationService.sendInviteEmail', () => {
  it('monta assunto/corpo com o loginUrl e delega ao provider configurado', async () => {
    const service = new NotificationService('fake-capture');

    const result = await service.sendInviteEmail({
      to: 'dev@example.com',
      recipientName: 'Dev Exemplo',
      tenantName: 'Acme Inc',
      loginUrl: 'http://127.0.0.1:3000/auth/github/login?tenantId=abc-123',
    });

    assert.equal(result.success, true);

    const provider = NotificationProviderFactory.create('fake-capture') as CapturingProvider;
    assert.equal(provider.lastMessage?.to[0]?.address, 'dev@example.com');
    assert.match(provider.lastMessage?.bodyHtml ?? '', /abc-123/);
    assert.match(provider.lastMessage?.bodyText ?? '', /abc-123/);
    assert.match(provider.lastMessage?.bodyHtml ?? '', /Acme Inc/);
  });
});
