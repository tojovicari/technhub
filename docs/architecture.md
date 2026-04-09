# Arquitetura do Sistema

## Visão Geral

O CTO.ai é dividido em camadas horizontais com responsabilidades bem definidas, permitindo que cada módulo evolua independentemente.

Regra obrigatoria de boundary: modulos trocam dados somente por contratos versionados (API/eventos). Nenhum modulo le ou escreve diretamente no storage interno de outro modulo.

Para reduzir custo no inicio, a Fase 1 usa **monolito modular** (um unico app no Fly.io) com isolamento logico por modulo e contracts-first. O desenho ja nasce preparado para evoluir para event bus externo sem reescrever regras de dominio.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Clientes                                    │
│         Web App          │         API Consumers (CLI, BI tools)    │
└────────────────────────────────────────────────────────────────────-┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────┐
│                  App Unica (Monolito Modular)                        │
│                     Node.js + Fastify @ Fly.io                       │
│                                                                       │
│  [Integrations] [Core] [SLA] [DORA] [COGS] [Intel] [IAM/Policy]       │
│                                                                       │
│  - REST APIs versionadas por modulo                                   │
│  - Scheduler interno (sync pull)                                      │
│  - Webhook receiver (push)                                            │
│  - Worker interno para jobs/eventos (poll em tabela)                  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│                           PostgreSQL                                 │
│  - Dados de dominio                                                   │
│  - Outbox de eventos                                                  │
│  - Fila de jobs (jobs table)                                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Camadas

### 1. App/API Layer (Fly Edge + Fastify)
- Ponto de entrada unico para clientes
- Responsavel por autenticacao (JWT/OAuth2), rate limiting, roteamento e logging
- Executa validacao inicial de tenant e claims obrigatorias (`tenant_id`, `roles`, `permission_profile_ids`)

### 2. Integration Module
- Responsável por toda comunicação com sistemas externos (JIRA, GitHub e futuros)
- Expõe dados normalizados para o Domain Service via eventos
- Dois modos de operação:
  - **Pull**: Scheduler dispara sync a cada intervalo configurável (ex: 15min)
  - **Push**: Recebe webhooks e processa em fila assíncrona
- Ver detalhes em [integrations.md](integrations.md)

### 3. Domain Modules (isolados no mesmo runtime)
- Contém as entidades de negócio e regras de domínio
- Persistem no banco relacional com ownership por modulo
- Expoem APIs REST versionadas por modulo
- Publicam eventos de dominio via outbox
- Ver entidades em [entities.md](entities.md)

**Módulos implementados:**

| Módulo | Prefixo de rota | Permissões | Contrato OpenAPI |
|---|---|---|---|
| Core | `/api/v1/core/*` | `core.*` | [core-v1.yaml](openapi/core-v1.yaml) |
| Integrations | `/api/v1/integrations/*` | `integrations.*` | [integrations-v1.yaml](openapi/integrations-v1.yaml) |
| SLA | `/api/v1/sla/*` | `sla.*` | [sla-v1.yaml](openapi/sla-v1.yaml) |
| DORA | `/api/v1/dora/*` | `dora.*` | [dora-v1.yaml](openapi/dora-v1.yaml) |
| COGS | `/api/v1/cogs/*` | `cogs.*` | [cogs-v1.yaml](openapi/cogs-v1.yaml) |
| Intel | `/api/v1/intel/*` | `intel.read` | [intel-v1.yaml](openapi/intel-v1.yaml) |
| IAM | `/api/v1/iam/*` | `iam.*` | [iam-v1.yaml](openapi/iam-v1.yaml) |

### 4. Analytics Worker (interno)
- Consome eventos da outbox/jobs table
- Calcula métricas pesadas de forma assíncrona
- Grava resultados em tabelas de aggregation / materialized views
- Ver detalhes em [dora-metrics.md](dora-metrics.md) e [cogs.md](cogs.md)

### 5. Event Backbone (fase inicial)
- Outbox pattern em Postgres para garantir entrega e idempotencia
- Jobs table para processamento assincrono (retries, backoff, dead-letter logico)
- Usado para webhook events, domain events, alertas e scheduled jobs
- Preparado para migrar para Redis/BullMQ ou Kafka sem quebrar contratos

### Contratos Entre Modulos
- API contracts versionados: REST/GraphQL (`v1`, `v2`), com schema publicado
- Event contracts versionados: `domain.event_name.vN`, com payload estavel por versao
- Contract tests obrigatorios para produtor e consumidor no CI
- Alteracoes breaking exigem nova versao e plano de migracao
- Proibido acesso cross-module ao banco (`SELECT`/`UPDATE` em schema de outro modulo)

### 6. Storage Layer
- **PostgreSQL**: dados relacionais, JSONB para campos variaveis, materialized views, outbox e jobs table
- **Redis**: opcional na Fase 2+ para cache/filas se houver pressao de latencia ou throughput

---

## Fluxo de Dados Principal

```
[JIRA/GitHub]
     │
     ▼
[Integrations Module]
  ├── normaliza DTO externo → entidade interna
  ├── deduplica (source + source_id)
  └── grava evento na outbox: task.synced.v1, pr.synced.v1
     │
     ▼
[Outbox Dispatcher / Worker]
     │
     ├──→ [Core/SLA/Metrics/COGS handlers] (mesmo app)
     │        ├── persiste Task/PR/User/Epic no Postgres
     │        ├── recalcula DORA/SLA
     │        └── atualiza agregacoes
     │
     └──→ [Publicacao futura em bus externo] (fase de escala)
     │
     ▼
[API Layer] ← polling ou push (SSE/WebSocket) → [Web App]
```

## Fluxo de Autorizacao (Backend)

```text
Request -> API Gateway
     -> valida JWT + tenant_id ativo
     -> roteia para modulo dono
Modulo dono
     -> carrega permissoes efetivas (roles + profiles)
     -> aplica policy RBAC/ABAC
     -> aplica filtro tenant/team na query
     -> permite ou retorna 403
```

Regras obrigatorias:
- Nenhuma rota de escrita sem verificacao de permissao no backend
- Nenhuma query sem predicado de tenant
- Dados financeiros detalhados exigem permissao explicita (`cogs.read.detailed`)

Contrato de referencia:
- `docs/openapi/authorization-policy-v1.yaml`

---

## Decisões Arquiteturais

| Decisão | Escolha | Justificativa |
|---|---|---|
| Runtime inicial | Monolito modular no Fly.io | Menor custo e operacao simplificada |
| Comunicação entre módulos | Event-ready com Outbox (Postgres) | Desacoplamento logico sem custo de infra extra |
| Boundary enforcement | Contract-first + storage ownership | Evita acoplamento e regressão entre módulos |
| Modelo de dados | Relacional + JSONB | Consistência + flexibilidade para campos customizados |
| Sync strategy | Pull + Push | Pull garante consistência; Push garante baixa latência |
| Aggregations | Materialized views + async jobs | Evita queries pesadas em tempo real |
| Multi-tenancy | Row-level security (por Team/Org) | Isolamento sem necessidade de múltiplos bancos |
| Authorization model | RBAC + Permission Profiles + ABAC | Controle granular com governanca por tenant |

---

## Escalabilidade

- **Passo 1 (agora)**: 1 app (web + worker interno) + 1 Postgres pequeno
- **Passo 2**: separar process groups (web e worker) dentro do Fly.io
- **Passo 3**: introduzir Redis/BullMQ para filas de maior throughput
- **Passo 4**: mover outbox dispatcher para bus externo (Kafka) quando necessario
- **Passo 5**: read replica e particionamento/sharding por crescimento de dados

---

## Segurança

- OAuth2 / SAML SSO para autenticação
- JWT de curta duração + refresh tokens
- Credentials de integracoes em Fly Secrets + tabela de referencias criptografadas
- Row-level security: usuários só veem dados de seus próprios teams/orgs
- HTTPS em trânsito, AES-256 em repouso para dados sensíveis

---

## Observabilidade

| Camada | Ferramenta |
|---|---|
| Métricas de infra | Fly Metrics + Grafana Cloud (opcional) |
| Logs estruturados | fly logs + log drains (JSON) |
| Tracing distribuído | OpenTelemetry |
| Alertas | Grafana Alerting / PagerDuty |
| Health checks | Endpoint `/health` em cada serviço |
