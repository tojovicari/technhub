# Módulo de Integrações

## Visão Geral

O módulo de integrações é o único ponto de contato com sistemas externos. Ele abstrai as particularidades de cada provider (JIRA, GitHub, etc.) e entrega dados normalizados para o core do sistema.

**Nenhum outro módulo faz chamadas diretas a sistemas externos.**
**Nenhum módulo consumidor acessa storage interno de integrações; consumo somente via contratos de API/eventos.**

---

## Contrato de Saida do Modulo

O modulo de Integracoes publica dados para outros modulos por contratos versionados.

- API de consulta (quando necessaria): endpoints versionados (`/api/v1/integrations/...`)
- Eventos de sync: `integration.project.synced.v1`, `integration.task.synced.v1`, `integration.user.synced.v1`
- Payloads imutaveis por versao
- Campos adicionados de forma backward compatible
- Breaking changes apenas em `v2+` com janela de deprecacao

### Exemplo de Event Contract

```json
{
  "event_name": "integration.task.synced.v1",
  "event_id": "uuid",
  "occurred_at": "2026-04-08T12:00:00Z",
  "source": "jira",
  "project_key": "AUTH",
  "payload": {
    "external_id": "AUTH-123",
    "title": "Fix login timeout",
    "status": "in_progress",
    "assignee_email": "dev@company.com",
    "updated_at": "2026-04-08T11:58:00Z"
  },
  "schema_version": 1
}
```

---

## Secrets e Chaves de API (Armazenamento Seguro)

Quando o uso de `secret_ref` externo nao for possivel, o modulo pode armazenar credenciais no banco com protecao obrigatoria.

### Regras obrigatorias

- Secrets nunca em texto plano no banco
- Secrets nunca retornam em respostas de API (campos `writeOnly`)
- Secrets nunca aparecem em logs, traces ou mensagens de erro
- Acesso de leitura de segredo restrito ao worker de integracoes em runtime

### Estrategia recomendada (DB encrypted)

1. Gerar DEK por registro de segredo
2. Criptografar segredo com AES-256-GCM usando DEK
3. Criptografar DEK com KMS/HSM (envelope encryption)
4. Persistir no banco apenas:
   - `ciphertext`
   - `dek_encrypted`
   - `key_id`
   - `algo`
   - `nonce`
   - `tag`
   - `rotated_at`
5. Decriptar apenas em memoria volatil durante a chamada ao provider

### Modelo de tabela sugerido

```text
integration_secrets
- id
- tenant_id
- connection_id
- secret_type
- ciphertext (bytea)
- dek_encrypted (bytea)
- key_id
- algo (aes-256-gcm)
- nonce
- auth_tag
- version
- rotated_at
- created_at
```

### Rotacao e higiene operacional

- Rotacao manual via `PUT /api/v1/integrations/connections/{connection_id}/secrets`
- Rotacao automatica periodica (ex.: 90 dias)
- Revogacao imediata em incidente
- Sanitizacao de memoria apos uso (best effort)

### Auditoria e deteccao de vazamento

- Eventos de auditoria:
  - `integrations.secret.created.v1`
  - `integrations.secret.rotated.v1`
  - `integrations.secret.access.denied.v1`
- DLP em logs para bloquear padroes de token/chave
- Alertas para tentativa de leitura nao autorizada

### Politica de API

- Endpoint de leitura de segredo bruto: proibido
- Endpoints retornam apenas metadados:
  - `secret_strategy`
  - `secret_last_rotated_at`
  - `secret_version`
  - `secret_health`

---

## Arquitetura do Módulo

```
integrations/
├── base/
│   ├── BaseConnector        ← interface que todo connector implementa
│   ├── SyncScheduler        ← agenda pulls periódicos
│   ├── WebhookReceiver      ← recebe push events e coloca na fila
│   ├── SyncStateManager     ← rastreia cursor/timestamp do último sync
│   └── ConnectorRegistry    ← registra e instancia connectors disponíveis
│
├── connectors/
│   ├── jira/
│   │   ├── JiraConnector
│   │   ├── JiraTransformer   ← JIRA DTO → domain entities
│   │   └── JiraWebhookHandler
│   │
│   └── github/
│       ├── GitHubConnector
│       ├── GitHubTransformer
│       └── GitHubWebhookHandler
│
└── queue/
    ├── WebhookQueue          ← fila de eventos inbound
    └── RetryQueue            ← failed syncs com backoff
```

---

## IntegrationConnector (Interface)

Contrato real implementado em `src/modules/integrations/connectors/base.ts`:

```typescript
type SyncInput = {
  tenantId: string;
  connectionId: string;
  mode: 'full' | 'incremental';
  /** Decoded credentials from IntegrationSecret (provider-specific shape) */
  credentials?: Record<string, unknown>;
  /** Connection scope config — e.g. { org: "my-org" } for GitHub */
  scope?: Record<string, unknown>;
  /** Populated for incremental syncs — only fetch items updated after this date */
  sinceDate?: Date;
};

type WebhookConfig = {
  eventIdHeader: string;    // header com ID único do evento no provider
  eventTypeHeader: string;  // header com o tipo do evento
  tokenEnvVar: string;      // env var com o token de validação
  devToken: string;         // token fallback em desenvolvimento
};

interface IntegrationConnector {
  provider: IntegrationProvider;
  webhookConfig: WebhookConfig;
  validateConfiguration(): Promise<void>;
  runSync(input: SyncInput): Promise<SyncResult>;
}
```

O `service.ts` resolve `credentials`, `scope` e `sinceDate` automaticamente antes de chamar `runSync` — o connector não precisa buscar esses dados.

### Tipos Suportados de Resource

| ResourceType      | JIRA            | GitHub             |
|-------------------|-----------------|--------------------|
| `projects`        | Projects        | Repositories       |
| `tasks`           | Issues          | Issues             |
| `epics`           | Epics           | Milestones         |
| `users`           | Users           | Members            |
| `sprints`         | Sprints         | —                  |
| `pull_requests`   | —               | Pull Requests      |
| `commits`         | —               | Commits            |
| `releases`        | —               | Releases / Tags    |

---

## Connector: JIRA

**Status:** implementado (`src/modules/integrations/connectors/jira.ts`)

### Autenticação

**API Token** (único método suportado no connector atual — Jira Cloud).

```json
// credentials ao criar a IntegrationConnection
{
  "auth_type": "token",
  "base_url": "https://myorg.atlassian.net",
  "email": "glauber@example.com",
  "access_token": "<jira-api-token>"
}
```

### Scope

```json
// scope ao criar a IntegrationConnection
{
  "project_keys": ["AUTH", "PLATFORM"]  // opcional — se ausente, sincroniza todos os projetos
}
```

### Entidades sincronizadas

| Fonte Jira | Entidade de domínio | Chave de upsert |
|---|---|---|
| Users (accountType=atlassian) | `User` | `tenantId + email` |
| Projects | `Project` | `tenantId + key (project key)` |
| Epics (issuetype=Epic) | `Epic` | `tenantId + source + sourceId (issue key)` |
| Issues (não-Epic) | `Task` | `tenantId + source + sourceId (issue key)` |

### Mapeamento issuetype → taskType

| issuetype Jira | `taskType` |
|---|---|
| `Bug`, `Defect` | `bug` |
| `Tech Debt`, `Technical Debt`, `Refactoring` | `tech_debt` |
| `Spike`, `Research` | `spike` |
| `Task`, `Sub-task`, `Chore` | `chore` |
| `Story`, `Feature`, outros | `feature` |

### Mapeamento priority → priority

| Priority Jira | `priority` |
|---|---|
| Critical, Blocker | `P0` |
| High, Major | `P1` |
| Medium (default) | `P2` |
| Low, Minor | `P3` |
| Trivial, Lowest | `P4` |

### Sync incremental

`sinceDate` = `finishedAt` do último `IntegrationSyncJob` com `status=success`.
Issues são filtradas no JQL com `updatedDate >= "YYYY-MM-DD"`. Full sync ignora o filtro.

### Epic Link

O vínculo Issue → Epic usa o campo customizado `customfield_10014` (padrão Jira Cloud).
Epics são sincronizadas antes das Issues para garantir que o `epicId` já existe no banco.

### Webhooks JIRA
Eventos capturados (via `x-atlassian-webhook-event` header):

| Evento             | Trigger                          |
|--------------------|----------------------------------|
| `jira:issue_updated` | Mudança de status, assignee, etc |
| `jira:issue_created` | Nova issue criada                |
| `sprint_started`   | Sprint iniciada                  |
| `sprint_closed`    | Sprint finalizada                |

---

## Connector: GitHub

**Status:** implementado (`src/modules/integrations/connectors/github.ts`)

### Autenticação

**GitHub App** (único método suportado no connector atual).

```json
// credentials ao criar a IntegrationConnection
{
  "auth_type": "app",
  "app_id": 123456,
  "private_key_pem": "-----BEGIN RSA PRIVATE KEY-----\n...",
  "installation_id": 789012
}
```

### Scope

```json
// scope ao criar a IntegrationConnection
{
  "org": "minha-org",
  "repos": ["api", "frontend"]  // opcional — se ausente, sincroniza todos os repos da org
}
```

### Entidades sincronizadas

| Fonte GitHub | Entidade de domínio | Chave de upsert |
|---|---|---|
| Org members | `User` | `tenantId + email` |
| Repositories | `Project` | `tenantId + key (org/repo)` |
| Milestones | `Epic` | `tenantId + source + sourceId` |
| Issues (não-PR) | `Task` (type via labels) | `tenantId + source + sourceId` |
| Pull Requests | `Task` (type=feature) | `tenantId + source + sourceId` |

### Mapeamento de labels → Task

| Labels | `taskType` | `priority` |
|---|---|---|
| `bug`, `defect`, `fix` | `bug` | — |
| `tech-debt`, `refactor` | `tech_debt` | — |
| `spike`, `research` | `spike` | — |
| `chore`, `ci`, `deps` | `chore` | — |
| outros | `feature` | — |
| `p0`, `critical`, `urgent` | — | `P0` |
| `p1`, `high` | — | `P1` |
| `p3`, `low` | — | `P3` |
| sem match | `feature` | `P2` |

### Sync incremental

`sinceDate` = `finishedAt` do último `IntegrationSyncJob` com `status=success`.
Issues e PRs são filtrados por `updated_at >= sinceDate`. Full sync ignora o filtro.

### Webhooks GitHub
Eventos capturados (via `x-github-event` header):

| Evento              | Trigger                          |
|---------------------|----------------------------------|
| `pull_request`      | Abertura, fechamento, merge, review |
| `push`              | Commits enviados                 |
| `release`           | Release publicada                |
| `issues`            | Issue aberta, fechada, atribuída |
| `check_run`         | CI/CD passou ou falhou           |
| `workflow_run`      | GitHub Actions concluído         |

---

## Sincronização: Pull Model

```
POST /api/v1/integrations/:connection_id/sync  (ou disparado pelo webhook worker)
  └── createSyncJob()
        ├── resolve credentials (IntegrationSecret → base64 decode → JSON payload)
        ├── resolve scope (IntegrationConnection.scope)
        ├── resolve sinceDate (finishedAt do último SyncJob com status=success)
        └── connector.runSync({ tenantId, connectionId, mode, credentials, scope, sinceDate })
              └── upsert de entidades por (tenantId, source, sourceId)
```

### Deduplicação
- Cada entidade usa `@@unique([tenantId, source, sourceId])` no banco
- Upsert idempotente — múltiplos syncs não geram duplicatas

---

## Sincronização: Push Model (Webhooks)

```
[JIRA / GitHub]
      │ POST /webhooks/{provider}
      ▼
WebhookReceiver
  ├── Valida assinatura HMAC do payload
  ├── Enfileira no WebhookQueue (Redis)
  └── Retorna 200 imediatamente

WebhookQueue
  └── Worker consome a fila:
       ├── Roteia para o handler correto (JiraWebhookHandler / GitHubWebhookHandler)
       ├── Transforma e publica evento de domínio
       └── Em falha → RetryQueue com backoff
```

### Validação de Webhooks
- **JIRA**: Header `X-Hub-Signature` (HMAC-SHA256)
- **GitHub**: Header `X-Hub-Signature-256` (HMAC-SHA256)
- Payloads com assinatura inválida são rejeitados com 401

---

## Adicionando um Novo Connector

### Arquitetura atual (implementado)

O registry de connectors vive em `src/modules/integrations/connectors/registry.ts`.
Cada connector é uma classe que implementa a interface `IntegrationConnector` definida em `connectors/base.ts`:

```typescript
// connectors/base.ts
export type WebhookConfig = {
  eventIdHeader: string;    // header com ID único do evento no provider
  eventTypeHeader: string;  // header com o tipo do evento
  tokenEnvVar: string;      // env var com o token de validação
  devToken: string;         // token fallback em desenvolvimento
};

export interface IntegrationConnector {
  provider: IntegrationProvider;
  webhookConfig: WebhookConfig;
  validateConfiguration(): Promise<void>;
  runSync(input: SyncInput): Promise<SyncResult>;
}
```

### Passos para adicionar um novo provider (ex: Linear)

**1. Criar o arquivo do connector:**

```typescript
// src/modules/integrations/connectors/linear.ts
import type { IntegrationConnector, SyncInput, SyncResult, WebhookConfig } from './base.js';

export class LinearConnector implements IntegrationConnector {
  provider = 'linear' as const;

  webhookConfig: WebhookConfig = {
    eventIdHeader: 'linear-delivery',       // ajustar conforme docs da Linear API
    eventTypeHeader: 'linear-event',
    tokenEnvVar: 'LINEAR_WEBHOOK_TOKEN',
    devToken: 'dev-linear-webhook-token',
  };

  async validateConfiguration(): Promise<void> {
    // validar credenciais contra a API da Linear
  }

  async runSync(input: SyncInput): Promise<SyncResult> {
    // implementar chamadas à Linear API
    return { provider: this.provider, mode: input.mode, synced_entities: 0 };
  }
}
```

**2. Registrar no registry:**

```typescript
// src/modules/integrations/connectors/registry.ts
import { LinearConnector } from './linear.js';

const connectorFactories = new Map<IntegrationProvider, () => IntegrationConnector>([
  ['github', () => new GithubConnector()],
  ['jira',   () => new JiraConnector()],
  ['linear', () => new LinearConnector()],   // ← adicionar aqui
]);
```

**3. Adicionar ao enum do banco (migration necessária):**

```prisma
// schema.prisma
enum IntegrationProvider {
  jira
  github
  linear   // ← adicionar e rodar: npx prisma migrate dev
}
```

**O que NÃO precisa mudar:**
- `service.ts` — usa `getConnector()` do registry
- `webhooks.ts` — lê `webhookConfig` do connector
- `webhook-routes.ts` — usa `isValidProvider()` do registry

Nenhuma alteração fora dos 3 arquivos listados acima.

---

## Estado de Sync

```
SyncState {
  connector_id: string
  resource_type: ResourceType
  last_sync_at: timestamp
  cursor: string | null       // page token ou ID do último item
  status: 'ok' | 'error' | 'running'
  error_count: number
  last_error?: string
}
```

---

## Métricas do Módulo

| Métrica                          | Descrição                                |
|----------------------------------|------------------------------------------|
| `integrations.sync.duration`     | Tempo de cada ciclo de sync              |
| `integrations.sync.items_fetched`| Itens coletados por sync                 |
| `integrations.sync.errors`       | Erros por connector e resource type      |
| `integrations.webhook.latency`   | Tempo entre recebimento e processamento  |
| `integrations.queue.depth`       | Tamanho da fila de webhooks              |
| `integrations.rate_limit.hits`   | Quantas vezes o rate limit foi atingido  |
