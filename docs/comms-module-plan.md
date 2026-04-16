# Communication Module

> Status: **Implemented** — provider: Resend SMTP; worker ativo; invite email e verificação de email em produção.  
> Frontend API reference: [`docs/frontend/comms-api.md`](frontend/comms-api.md)

---

## Context

O módulo centraliza toda comunicação de saída da plataforma. Business modules nunca chamam providers diretamente — eles enfileiram uma notificação via `enqueueNotification()` e o worker despacha de forma assíncrona.

---

## Goals

- Entregar mensagens transacionais (invite, SLA breach, DORA digest, etc.) por múltiplos canais.
- Desacoplar business modules da entrega — chamam `comms` via contrato interno, nunca um provider específico.
- Arquitetura sem broker externo: fila DB-backed + worker `setInterval` (mesmo padrão de `integrations/worker.ts`).

---

## Estrutura de arquivos (implementado)

```
modules/
  comms/
    providers/
      email/
        smtp.ts            ← smtpEmailProvider via Resend SMTP (nodemailer)
      slack/
        provider.ts        ← SlackProvider — stub (no-op)
      whatsapp/
        provider.ts        ← WhatsAppProvider — stub (no-op)
    templates/
      index.ts             ← renderTemplate(key, payload) → { subject, body }
      invite.ts            ← ✅ ativo
      email-verification.ts← ✅ ativo
      sla-breach.ts        ← ⏸ pronto, não disparado ainda
      dora-digest.ts       ← ⏸ pronto, não disparado ainda
    channel-provider.ts    ← interface ChannelProvider + tipos
    service.ts             ← enqueueNotification(), processQueue(), listNotifications(), retryNotification()
    worker.ts              ← setInterval polling (batch 20, a cada 5s)
    routes.ts              ← admin routes: list + retry
    schema.ts              ← Zod schemas para as admin routes
```

---

## Channel Provider Contract

```ts
// channel-provider.ts
export type Channel = 'email' | 'slack' | 'whatsapp';

export interface OutboundMessage {
  to: string;
  channel: Channel;
  subject?: string;
  body: string;
}

export interface ChannelProvider {
  readonly channel: Channel;
  send(message: OutboundMessage): Promise<void>;
}
```

---

## Internal API — enqueueNotification()

Única forma de outros módulos acionarem o comms. Sem boundary HTTP — import direto.

```ts
// comms/service.ts
export async function enqueueNotification(input: {
  tenantId:    string;
  channel:     Channel;
  recipient:   string;
  templateKey: string;
  payload:     Record<string, unknown>;
}): Promise<void>
```

---

## Notification Queue (DB-backed)

```prisma
model Notification {
  id          String             @id @default(uuid())
  tenantId    String
  channel     String
  recipient   String
  templateKey String
  payload     Json
  status      NotificationStatus @default(queued)
  attempts    Int                @default(0)
  lastError   String?
  nextRetryAt DateTime?
  sentAt      DateTime?
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt
}

enum NotificationStatus { queued | processing | sent | failed }
```

### Worker

```ts
// worker.ts — registrado em server.ts
startCommsWorker(app)  // setInterval(processQueue(20), 5000ms)
```

`processQueue` usa optimistic-lock (`updateMany queued → processing`) para segurança em concorrência futura.

### Retry

| Tentativa | Backoff |
|-----------|---------|
| 1ª falha | 2 min |
| 2ª falha | 4 min |
| 3ª falha (final) | status → `failed` |

---

## Casos de uso implementados

### 1. Invite de novo usuário ✅

**Trigger:** `POST /auth/invites` → `createInvite()` em `auth/service.ts`  
**Template:** `invite`  
**Canal:** email  
**Payload:**

```ts
{
  email:        string;   // destinatário
  invite_token: string;   // token raw (hash armazenado no DB)
  expires_at:   string;   // ISO — 48h a partir da criação
}
```

**Email gerado:**
- Subject: `You have been invited to moasy.tech`
- Link: `APP_BASE_URL/register?token=<token>`

> **Nota sobre verificação de email no convite:**  
> O fluxo de invite já funciona como verificação implícita — apenas quem recebeu o email consegue o token para completar o cadastro. Adicionar um passo extra de verificação seria redundante e criaria fricção desnecessária. **Decisão: não implementar verificação de email** para usuários cadastrados via invite.

---

### 2. Verificação de email no cadastro (1º usuário da tenant) ✅

**Contexto:** `POST /auth/register` cria o primeiro usuário + tenant. Não há verificação implícita (ao contrário do invite), portanto o email precisa ser confirmado explicitamente para garantir titularidade.

**Fluxo implementado:**

```
POST /auth/register
  ├── cria tenant + PlatformAccount (isActive: false)
  ├── gera EmailVerificationToken (hash SHA256, TTL: 24h)
  ├── enqueueNotification(templateKey: 'email-verification')
  └── retorna 201 com { ..., is_active: false, message: "Check your email..." }

Worker envia email → link APP_BASE_URL/verify-email?token=<raw_token>

POST /auth/verify-email  (público, sem auth)
  ├── valida token (hash + expiresAt + usedAt)
  ├── PlatformAccount.isActive: true + EmailVerificationToken.usedAt: agora
  └── retorna 200 com { id, email, is_active: true }

POST /auth/verify-email/resend  (público, sem auth)
  ├── busca conta pelo email
  ├── se não existe ou já está ativa → retorna 200 silenciosamente (anti-enumeration)
  └── cria novo token + enfileira novo email

POST /auth/login
  └── conta não verificada → 403 ACCOUNT_NOT_VERIFIED
```

**Migration:** `20260416113612_add_email_verification_token`

```prisma
model EmailVerificationToken {
  id        String          @id @default(uuid())
  accountId String
  tokenHash String          @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime        @default(now())

  account   PlatformAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
}
```

**Template:** `email-verification`  
**Canal:** email  
**Payload:**

```ts
{
  email:              string;
  verification_token: string;   // token raw
  expires_at:         string;   // ISO — 24h
}
```

**Email gerado:**
- Subject: `Confirm your moasy.tech account`
- Link: `APP_BASE_URL/verify-email?token=<token>`

**Novas routes auth:**

| Método | Path | Auth | Descrição |
|--------|------|------|-----------|
| `POST` | `/auth/verify-email` | pública | Ativa conta consumindo token |
| `POST` | `/auth/verify-email/resend` | pública | Reenvia email para contas `isActive: false` |

**Mudanças em código existente (aplicadas):**
- `auth/service.ts: register()` — `isActive: false` + gerar token + enqueue
- `auth/service.ts: login()` — rejeitar com `ACCOUNT_NOT_VERIFIED` se `!isActive`
- `auth/service.ts: verifyEmail()` + `resendVerification()` — novas funções
- `auth/routes.ts` — duas novas routes públicas adicionadas
- `comms/templates/index.ts` — `'email-verification'` registrado
- `comms/service.ts: listNotifications()` — campos corrigidos para snake_case

**Riscos:**
- Usuário não recebe email e fica bloqueado → rota de reenvio mitiga
- Token expirado → reenvio gera novo token; tokens anteriores **não** são invalidados via `usedAt` — continuam válidos até `expiresAt`. O primeiro token usado ativa a conta; os demais expiram naturalmente.

---

### 3. Reset de senha ✅

**Trigger:** `POST /auth/password-reset/request` → `requestPasswordReset()` em `auth/service.ts`  
**Template:** `password-reset`  
**Canal:** email  
**Payload:**

```ts
{
  email:       string;
  reset_token: string;   // token raw (hash SHA256 armazenado no DB)
  expires_at:  string;   // ISO — 1h a partir da criação
}
```

**Email gerado:**
- Subject: `Reset your moasy.tech password`
- Link: `APP_BASE_URL/reset-password?token=<token>`

**Fluxo implementado:**

```
POST /auth/password-reset/request  (público, anti-enumeration)
  ├── busca conta pelo email
  ├── se não existe → retorna 200 silenciosamente
  └── gera PasswordResetToken (hash SHA256, TTL: 1h) + enqueue 'password-reset'

POST /auth/password-reset/confirm  (público)
  ├── valida token (hash + expiresAt + usedAt)
  ├── atualiza passwordHash na conta
  ├── marca token usedAt: agora
  └── revoga todos os refresh tokens ativos (força re-login em todas as sessões)
```

**Migration:** `20260416120513_add_password_reset_token`

```prisma
model PasswordResetToken {
  id        String          @id @default(uuid())
  accountId String
  tokenHash String          @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime        @default(now())

  account   PlatformAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
}
```

**Novas routes auth:**

| Método | Path | Auth | Descrição |
|--------|------|------|-----------|
| `POST` | `/auth/password-reset/request` | pública | Envia email de reset (anti-enumeration) |
| `POST` | `/auth/password-reset/confirm` | pública | Aplica nova senha, revoga sessões |

**Riscos:**
- Múltiplos tokens gerados por requests seguidos: todos válidos por 1h. Apenas o primeiro `confirm` bem-sucedido consome o token.
- Revogar refresh tokens pode surpreender usuários conectados em múltiplos dispositivos — comportamento intencional por segurança.

---

### 4. SLA Breach alert ⏸ (template pronto, trigger não implementado)

**Template:** `sla-breach`  
**Canal:** email (previsto)  
**Payload:**

```ts
{
  task_id:     string;
  task_title:  string;
  sla_name:    string;
  breached_at: string;
  tenant_name?: string;
}
```

**Próximo passo:** wiring no SLA worker ao detectar breach.

---

### 4. DORA Digest semanal ⏸ (template pronto, trigger não implementado)

**Template:** `dora-digest`  
**Canal:** email (previsto)  
**Payload:**

```ts
{
  period:                  string;   // ex: "2026-W15"
  team_name:               string;
  deployment_frequency?:   string;
  lead_time_for_changes?:  string;
  change_failure_rate?:    string;
  mean_time_to_restore?:   string;
}
```

**Próximo passo:** job agendado (semanal) ou trigger manual via admin route.

---

## Admin HTTP Routes

| Método | Path | Permissão | Descrição |
|--------|------|-----------|-----------|
| `GET` | `/comms/notifications` | `comms.notifications.read` | Lista notificações do tenant (paginado, filtrável por status/channel) |
| `POST` | `/comms/notifications/:id/retry` | `comms.notifications.retry` | Recoloca notificação `failed` em `queued` |

### Filtros disponíveis (GET)

| Param | Tipo | Default |
|-------|------|---------|
| `status` | `queued\|processing\|sent\|failed` | — |
| `channel` | `email\|slack\|whatsapp` | — |
| `page` | number | 1 |
| `per_page` | number (max 100) | 20 |

---

## Configuração

```env
# Provider: Resend SMTP
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_<api_key>

# Remetente
COMMS_FROM_EMAIL=no-reply@moasy.tech
COMMS_FROM_NAME=moasy.tech

# Worker
APP_BASE_URL=https://app.moasy.tech
COMMS_WORKER_INTERVAL_MS=5000
```

> Porta 465 usa `secure: true` via SSL. Para 587, TLS é negociado automaticamente.

---

## Decisões

| Questão | Decisão |
|---------|---------|
| Provider de email | **Resend SMTP** via nodemailer — free tier 3k/mês, boa deliverability |
| Modo de despacho | **Async** — fila no DB + worker (sem broker externo) |
| Templates | **HTML com template literals** — sem engine externa |
| Verificação de email (invite) | **Não necessária** — invite token já valida posse do email |
| Verificação de email (register) | **Necessária** — `POST /auth/register` não tem verificação implícita; conta criada com `isActive: false` até confirmação |
| Slack/WhatsApp | **Stubs** existem para garantir extensibilidade sem retrabalho |
| Config de tenant | **Global por plataforma** — sem config por-tenant por ora |

---

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Provider indisponível | Retry queue + status `failed` visível nas admin routes |
| Erro de rendering | Exceção capturada → `failed` com `lastError`; nunca silenciado |
| PII em logs | `recipient` não logado; armazenado só no registro `Notification` |
| Isolamento por tenant | Todas as queries escopadas por `tenantId` |

