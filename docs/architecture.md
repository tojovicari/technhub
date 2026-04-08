# Arquitetura do Sistema

## Visão Geral

O CTO.ai é dividido em camadas horizontais com responsabilidades bem definidas, permitindo que cada módulo evolua independentemente.

Regra obrigatoria de boundary: modulos trocam dados somente por contratos versionados (API/eventos). Nenhum modulo le ou escreve diretamente no storage interno de outro modulo.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Clientes                                    │
│         Web App          │         API Consumers (CLI, BI tools)    │
└────────────────────────────────────────────────────────────────────-┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────┐
│                         API Gateway                                  │
│         Autenticação · Rate Limiting · Roteamento · Logging         │
└─────────────────────────────────────────────────────────────────────┘
          │                   │                    │
┌─────────▼────────┐  ┌───────▼──────────┐  ┌─────▼────────────────┐
│  Integrations    │  │  Domain Service  │  │  Analytics Engine    │
│  Module          │  │  (Core)          │  │                      │
│                  │  │                  │  │  - DORA Metrics      │
│  - JiraConnector │  │  - Projects      │  │  - Health Scores     │
│  - GithubConnect │  │  - Tasks         │  │  - COGS Aggregation  │
│  - [Extensível]  │  │  - Epics         │  │  - Forecasting       │
│                  │  │  - Users/Teams   │  │                      │
│  Push (webhooks) │  │  - SLAs          │  │                      │
│  Pull (scheduler)│  │  - HealthMetrics │  │                      │
└─────────┬────────┘  └───────┬──────────┘  └─────┬────────────────┘
          │                   │                    │
┌─────────▼───────────────────▼────────────────────▼─────────────────┐
│                         Message Bus                                  │
│                   (Eventos domain + webhook queue)                   │
└──────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│                         Storage Layer                                │
│     PostgreSQL (relacional)  │  Redis (cache + filas)               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Camadas

### 1. API Gateway
- Ponto de entrada único para todos os clientes
- Responsável por: autenticação (JWT/OAuth2), rate limiting, roteamento, logging centralizado
- **Não contém lógica de negócio**

### 2. Integration Module
- Responsável por toda comunicação com sistemas externos (JIRA, GitHub e futuros)
- Expõe dados normalizados para o Domain Service via eventos
- Dois modos de operação:
  - **Pull**: Scheduler dispara sync a cada intervalo configurável (ex: 15min)
  - **Push**: Recebe webhooks e processa em fila assíncrona
- Ver detalhes em [integrations.md](integrations.md)

### 3. Domain Service (Core)
- Contém as entidades de negócio e regras de domínio
- Persiste no banco relacional
- Expõe API REST/GraphQL para o API Gateway
- Publica eventos de domínio no Message Bus
- Ver entidades em [entities.md](entities.md)

### 4. Analytics Engine
- Consome eventos do Message Bus e dados do banco
- Calcula métricas pesadas de forma assíncrona
- Grava resultados em tabelas de aggregation / materialized views
- Ver detalhes em [dora-metrics.md](dora-metrics.md) e [cogs.md](cogs.md)

### 5. Message Bus
- Desacopla produtores de consumidores
- Garante entrega de eventos mesmo com falha temporária de um serviço
- Usado para: webhook events, domain events, alertas, scheduled jobs

### Contratos Entre Modulos
- API contracts versionados: REST/GraphQL (`v1`, `v2`), com schema publicado
- Event contracts versionados: `domain.event_name.vN`, com payload estavel por versao
- Contract tests obrigatorios para produtor e consumidor no CI
- Alteracoes breaking exigem nova versao e plano de migracao
- Proibido acesso cross-module ao banco (`SELECT`/`UPDATE` em schema de outro modulo)

### 6. Storage Layer
- **PostgreSQL**: dados relacionais, JSONB para campos variáveis, materialized views para relatórios
- **Redis**: cache de API, filas de retry, contadores de rate limit, estado de sync

---

## Fluxo de Dados Principal

```
[JIRA/GitHub]
     │
     ▼
[Integration Module]
  ├── normaliza DTO externo → entidade interna
  ├── deduplica (source + source_id)
  └── emite evento: task.synced, pr.synced, etc.
     │
     ▼
[Message Bus]
     │
     ├──→ [Domain Service]  → persiste Task/PR/User/Epic no Postgres
     │
     └──→ [Analytics Engine]
              ├── recalcula DORA metrics
              ├── verifica SLA compliance
              └── atualiza health score do projeto
     │
     ▼
[API Gateway] ← polling ou push (SSE/WebSocket) → [Web App]
```

---

## Decisões Arquiteturais

| Decisão | Escolha | Justificativa |
|---|---|---|
| Comunicação entre módulos | Event-driven (Message Bus) | Desacoplamento e resiliência |
| Boundary enforcement | Contract-first + storage ownership | Evita acoplamento e regressão entre módulos |
| Modelo de dados | Relacional + JSONB | Consistência + flexibilidade para campos customizados |
| Sync strategy | Pull + Push | Pull garante consistência; Push garante baixa latência |
| Aggregations | Materialized views + async jobs | Evita queries pesadas em tempo real |
| Multi-tenancy | Row-level security (por Team/Org) | Isolamento sem necessidade de múltiplos bancos |

---

## Escalabilidade

- **Horizontal**: Domain Service e Analytics Engine são stateless, escaláveis via replicas
- **Leitura**: Read replicas do Postgres para relatórios e dashboards
- **Write**: Connection pooling (PgBouncer)
- **Futuro**: Sharding por `project_id` se volume ultrapassa 50M tasks

---

## Segurança

- OAuth2 / SAML SSO para autenticação
- JWT de curta duração + refresh tokens
- Credentials de integrações armazenados em Vault (HashiCorp ou AWS Secrets Manager)
- Row-level security: usuários só veem dados de seus próprios teams/orgs
- HTTPS em trânsito, AES-256 em repouso para dados sensíveis

---

## Observabilidade

| Camada | Ferramenta |
|---|---|
| Métricas de infra | Prometheus + Grafana |
| Logs estruturados | ELK Stack / CloudWatch |
| Tracing distribuído | OpenTelemetry |
| Alertas | Alertmanager / PagerDuty |
| Health checks | Endpoint `/health` em cada serviço |
