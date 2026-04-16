import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { Channel, ChannelProvider } from './channel-provider.js';
import { smtpEmailProvider } from './providers/email/smtp.js';
import { slackProvider } from './providers/slack/provider.js';
import { whatsappProvider } from './providers/whatsapp/provider.js';
import { renderTemplate } from './templates/index.js';
import type { ListNotificationsQuery } from './schema.js';

// ── Provider registry ─────────────────────────────────────────────────────────

const providers = new Map<Channel, ChannelProvider>([
  ['email',    smtpEmailProvider],
  ['slack',    slackProvider],
  ['whatsapp', whatsappProvider],
]);

// ── Enqueue ───────────────────────────────────────────────────────────────────

export interface EnqueueNotificationInput {
  tenantId: string;
  channel: Channel;
  recipient: string;
  templateKey: string;
  payload: Record<string, unknown>;
}

export async function enqueueNotification(input: EnqueueNotificationInput): Promise<void> {
  await prisma.notification.create({
    data: {
      tenantId:    input.tenantId,
      channel:     input.channel,
      recipient:   input.recipient,
      templateKey: input.templateKey,
      payload:     input.payload as Prisma.InputJsonValue,
    },
  });
}

// ── Queue processor ───────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;

interface Logger {
  error(obj: object, msg: string): void;
}

export async function processQueue(batchSize: number, log: Logger): Promise<void> {
  const now = new Date();

  const batch = await prisma.notification.findMany({
    where: {
      status: 'queued',
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take:    batchSize,
  });

  for (const record of batch) {
    // Optimistic-lock: only proceed if we can claim this record
    const claimed = await prisma.notification.updateMany({
      where: { id: record.id, status: 'queued' },
      data:  { status: 'processing' },
    });
    if (claimed.count === 0) continue;

    try {
      const provider = providers.get(record.channel as Channel);
      if (!provider) throw new Error(`No provider registered for channel: ${record.channel}`);

      const message = renderTemplate(record.templateKey, record.payload as Record<string, unknown>);

      await provider.send({
        to:      record.recipient,
        channel: record.channel as Channel,
        subject: message.subject,
        body:    message.body,
      });

      await prisma.notification.update({
        where: { id: record.id },
        data:  { status: 'sent', sentAt: new Date() },
      });
    } catch (error) {
      const attempts = record.attempts + 1;
      const isFinal  = attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.pow(2, attempts) * 60_000; // 2 min, 4 min, 8 min

      await prisma.notification.update({
        where: { id: record.id },
        data:  {
          status:      isFinal ? 'failed' : 'queued',
          attempts,
          lastError:   error instanceof Error ? error.message : String(error),
          nextRetryAt: isFinal ? null : new Date(Date.now() + backoffMs),
        },
      });

      log.error({ notificationId: record.id, channel: record.channel }, 'Failed to send notification');
    }
  }
}

// ── Admin helpers ─────────────────────────────────────────────────────────────

export async function listNotifications(tenantId: string, query: ListNotificationsQuery) {
  const { status, channel, page, per_page } = query;
  const skip = (page - 1) * per_page;

  const [rawItems, total] = await prisma.$transaction([
    prisma.notification.findMany({
      where: {
        tenantId,
        ...(status  ? { status }  : {}),
        ...(channel ? { channel } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: per_page,
      select: {
        id:          true,
        channel:     true,
        recipient:   true,
        templateKey: true,
        status:      true,
        attempts:    true,
        lastError:   true,
        nextRetryAt: true,
        sentAt:      true,
        createdAt:   true,
      },
    }),
    prisma.notification.count({
      where: {
        tenantId,
        ...(status  ? { status }  : {}),
        ...(channel ? { channel } : {}),
      },
    }),
  ]);

  const items = rawItems.map(n => ({
    id:            n.id,
    channel:       n.channel,
    recipient:     n.recipient,
    template_key:  n.templateKey,
    status:        n.status,
    attempts:      n.attempts,
    last_error:    n.lastError,
    next_retry_at: n.nextRetryAt?.toISOString() ?? null,
    sent_at:       n.sentAt?.toISOString() ?? null,
    created_at:    n.createdAt.toISOString(),
  }));

  return { items, total, page, per_page };
}

export async function retryNotification(id: string, tenantId: string) {
  const record = await prisma.notification.findFirst({
    where: { id, tenantId },
  });

  if (!record || record.status !== 'failed') return null;

  return prisma.notification.update({
    where: { id },
    data:  { status: 'queued', attempts: 0, lastError: null, nextRetryAt: null },
    select: { id: true, status: true },
  });
}
