# Communication Module — Planning

> Status: **Implemented** — migration applied, worker registrado, invite email ativo.  
> Frontend API reference: [`docs/frontend/comms-api.md`](frontend/comms-api.md)

---

## Context

Today the platform has **zero notification infrastructure**. The invite flow already creates `Invite` records and returns a `invite_token`, but no email is dispatched — the caller (frontend/admin) is expected to forward the link manually.

This module creates the foundation for all outbound communication, starting with email and extensible to Slack, WhatsApp, and any future channel without touching the core business modules.

---

## Goals

- Deliver transactional messages (invite, SLA breach, DORA digest, etc.) across multiple channels.
- Decouple business modules from notification delivery — they call `comms` via a clear internal contract, never a specific provider.
- Stay aligned with the existing **no external broker** architecture (DB-backed async queue, same pattern as `integrations/worker.ts`).

---

## Architecture Overview

```
modules/
  comms/
    providers/
      email/
        provider.ts        ← EmailProvider implements ChannelProvider
        nodemailer.ts      ← (or resend.ts / sendgrid.ts)
      slack/
        provider.ts        ← SlackProvider (stub for now)
      whatsapp/
        provider.ts        ← WhatsAppProvider (stub for now)
    templates/
      invite.ts
      sla-breach.ts
      dora-digest.ts
    channel-provider.ts    ← ChannelProvider interface
    service.ts             ← enqueueNotification(), processQueue()
    worker.ts              ← setInterval polling (same pattern as integrations)
    routes.ts              ← admin routes (optional: list/retry failed)
    schema.ts
```

### Channel Provider Contract

```ts
// channel-provider.ts
export interface Message {
  to: string;            // email address, Slack user ID, phone number, etc.
  subject?: string;      // email only
  body: string;          // rendered text/HTML
  channel: Channel;
  metadata?: Record<string, unknown>;
}

export type Channel = 'email' | 'slack' | 'whatsapp';

export interface ChannelProvider {
  channel: Channel;
  send(message: Message): Promise<void>;
}
```

### Template Contract

```ts
// Template: pure function — input data → rendered string
export interface Template<T extends Record<string, unknown>> {
  subject?: (data: T) => string;   // email only
  body: (data: T) => string;       // plain text or HTML
}
```

---

## Notification Queue (DB-backed, async)

### Prisma model

```prisma
model Notification {
  id          String             @id @default(uuid())
  tenantId    String
  channel     String             // 'email' | 'slack' | 'whatsapp'
  recipient   String             // email / userID / phone
  templateKey String
  payload     Json               // template variables (typed in service layer)
  status      NotificationStatus @default(queued)
  attempts    Int                @default(0)
  lastError   String?
  sentAt      DateTime?
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  @@index([tenantId, status])
  @@index([status, createdAt])   // for worker batch queries
}

enum NotificationStatus {
  queued
  processing
  sent
  failed
}
```

### Worker (same pattern as `integrations/worker.ts`)

```ts
// worker.ts
export function startCommsWorker(app: FastifyInstance) {
  const timer = setInterval(() => processQueue(20), 5_000);
  app.addHook('onClose', async () => clearInterval(timer));
}
```

`processQueue(batchSize)` uses the same optimistic-locking pattern as webhook events:
1. `updateMany` status `queued → processing` with `take: batchSize`
2. For each record: render template → call provider → mark `sent` or increment `attempts` / mark `failed`

---

## Internal API (used by other modules)

```ts
// comms/service.ts — exported for internal use only (no HTTP route needed)
export async function enqueueNotification(input: {
  tenantId: string;
  channel: Channel;
  recipient: string;
  templateKey: string;
  payload: Record<string, unknown>;
}): Promise<void>
```

Calling example (auth module — invite):
```ts
// auth/service.ts
import { enqueueNotification } from '../comms/service.js';

await enqueueNotification({
  tenantId,
  channel: 'email',
  recipient: invite.email,
  templateKey: 'invite',
  payload: { invite_token: rawToken, expires_at: expiresAt }
});
```

---

## Phase 1 Scope

| Item | Description |
|------|-------------|
| `ChannelProvider` interface | Definida uma vez; todos os providers implementam |
| `EmailProvider` (Nodemailer/SMTP) | Implementação real via SMTP (Mailtrap sandbox → qualquer SMTP em prod) |
| `SlackProvider` | Stub — loga aviso, no-op |
| `WhatsAppProvider` | Stub — loga aviso, no-op |
| Template: `invite` | Subject + HTML body com link de convite |
| Template: `sla-breach` | Alerta de violação de SLA |
| Template: `dora-digest` | Digest semanal de métricas DORA |
| `Notification` model + migration | Tabela de fila no Prisma |
| `enqueueNotification()` | Função interna, sem boundary HTTP |
| Worker | `setInterval` polling, batch 20, a cada 5s |
| Retry logic | Máx 3 tentativas, backoff em `nextRetryAt` |
| Admin routes | `GET /comms/notifications` + `POST /comms/notifications/:id/retry` |

---

## Configuration

Environment variables (`.env` / Fly secrets):

```
SMTP_HOST=sandbox.smtp.mailtrap.io   # qualquer SMTP em prod (ex: smtp.sendgrid.net)
SMTP_PORT=2525                       # 587 ou 465 em prod
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
COMMS_FROM_EMAIL=no-reply@cto.ai
COMMS_FROM_NAME=CTO.ai
APP_BASE_URL=https://app.cto.ai
COMMS_WORKER_INTERVAL_MS=5000
```

---

## Decisions

| Question | Decision |
|----------|----------|
| Email provider | **Nodemailer/SMTP** — Mailtrap sandbox local; troca de host/user/pass em prod |
| Dispatch mode | **Async** — fila no DB + worker (mesmo padrão de `integrations`) |
| Templates | **HTML com template literals** (sem engine externa) |
| Phase 1 use cases | Invite email, SLA breach alert, DORA digest semanal |
| Tenant config | **Plataforma única** — uma config global |
| Admin routes | **Sim** — `GET /comms/notifications` + `POST /comms/notifications/:id/retry` |
| Slack/WhatsApp | **Stubs** criados desde o início para garantir extensibilidade |

---

## Risks

| Risk | Mitigation |
|------|------------|
| Provider outage | Retry queue com max attempts + status `failed` para visibilidade |
| Erros de rendering de template | Capturar + marcar failed antes de enviar; nunca silenciar |
| PII em logs | Mascarar `recipient` nos logs; armazenar só no registro `Notification` |
| Isolamento por tenant | Todas as queries escopadas por `tenantId` |

