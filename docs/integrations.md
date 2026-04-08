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

## BaseConnector (Interface)

Todo connector deve implementar este contrato:

```typescript
interface BaseConnector {
  // Autentica com o provider externo
  authenticate(): Promise<void>

  // Verifica se a conexão está saudável
  healthCheck(): Promise<ConnectorStatus>

  // Busca dados de um recurso específico com filtros opcionais
  fetchData(resource: ResourceType, filter: FetchFilter): Promise<ExternalDTO[]>

  // Transforma um DTO externo para a entidade de domínio interna
  transformToDomain(dto: ExternalDTO): DomainEntity

  // Retorna o estado atual do sync (cursor/timestamp)
  getSyncState(): SyncState

  // Atualiza o estado após um sync bem-sucedido
  setSyncState(state: SyncState): Promise<void>
}
```

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

### Autenticação
- API Token (Basic Auth com email + token)
- OAuth 2.0 (para instâncias JIRA Cloud)

### Recursos sincronizados
- **Projects**: Nome, key, status, metadata
- **Sprints**: Datas, status (active/closed/future), velocidade
- **Issues (Tasks)**: Status, assignee, story points, tipo, prioridade, datas, SLA fields
- **Epics**: Issues agrupadas, progresso, datas
- **Changelogs**: Histórico de transições de status (para cálculo de cycle time)
- **Users**: Perfis e permissões

### Rate Limiting JIRA
- 300 req/min (Cloud) — gerenciado pelo SyncScheduler
- Retry automático com exponential backoff ao receber 429

### Webhooks JIRA
Eventos capturados:

| Evento             | Trigger                          |
|--------------------|----------------------------------|
| `jira:issue_updated` | Mudança de status, assignee, etc |
| `jira:issue_created` | Nova issue criada                |
| `sprint_started`   | Sprint iniciada                  |
| `sprint_closed`    | Sprint finalizada                |

---

## Connector: GitHub

### Autenticação
- GitHub App (recomendado — permissões granulares)
- Personal Access Token (dev/staging)

### Recursos sincronizados
- **Repositories**: Metadata, linguagens, configurações
- **Issues**: Labels, assignees, milestones, datas
- **Pull Requests**: Status, reviewers, checks, datas de abertura/merge
- **Commits**: Hash, autor, data, mensagem, arquivos alterados
- **Releases / Tags**: Versão, data (base para Deployment Frequency)
- **Check Runs**: Status de CI/CD (base para Change Failure Rate)

### Webhooks GitHub
Eventos capturados:

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
SyncScheduler
└── a cada X minutos (configurável por projeto/connector):
    1. Consulta SyncStateManager → obtém cursor (timestamp ou page token)
    2. Chama connector.fetchData(resource, { since: cursor })
    3. Para cada item retornado:
        a. connector.transformToDomain(dto) → DomainEntity
        b. Deduplica via (source, source_id)
        c. Publica evento no Message Bus
    4. Atualiza SyncState com novo cursor
    5. Em caso de falha → enfileira no RetryQueue
```

### Deduplicação
- Cada entidade recebe um identificador composto: `{source}:{source_id}` (ex: `jira:PROJ-123`)
- Upsert no banco por esse identificador — sem duplicação, sem perda de dados customizados

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

Para integrar um novo provider (ex: Linear, Trello, Azure DevOps):

1. Criar `connectors/linear/LinearConnector` implementando `BaseConnector`
2. Criar `connectors/linear/LinearTransformer` mapeando DTOs externos para domain entities
3. Criar `connectors/linear/LinearWebhookHandler` (se o provider suportar webhooks)
4. Registrar no `ConnectorRegistry`:
   ```typescript
   registry.register('linear', LinearConnector)
   ```
5. Adicionar configuração de autenticação no Vault/Secrets Manager

Nenhuma alteração necessária no core do sistema.

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
