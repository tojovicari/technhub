# Tech Stack

## Princípios de Escolha

- **Pragmatismo**: tecnologias amplamente adotadas com ecossistema maduro
- **Escalabilidade progressiva**: funciona bem no MVP e escala com o produto
- **Operabilidade**: fácil de monitorar, debugar e manter
- **Time-to-value**: velocidade de desenvolvimento sem sacrificar qualidade

---

## Stack Principal

### Backend

| Componente      | Tecnologia          | Justificativa                                                    |
|-----------------|---------------------|------------------------------------------------------------------|
| Framework API   | **Node.js + Fastify** | Alta performance, baixa latência, ecossistema rico para integrações |
| ORM             | **Prisma**          | Type-safe, migrations declarativas, excelente DX                 |
| Banco de dados  | **PostgreSQL**      | Relacional + JSONB para campos variáveis, maduro, SQL completo   |
| Runtime         | **Monolito modular no Fly.io** | Menor custo operacional com isolamento logico por modulo |
| Async/Jobs      | **PostgreSQL Outbox + Jobs table** | Event-driven logico sem dependencia de infra extra |
| Autenticação    | **OAuth2 + JWT**    | Padrão de mercado; integra com Google/Microsoft para SSO         |
| Secrets         | **Fly Secrets** + KMS externo opcional | Credentials do JIRA/GitHub jamais no código |
| Scheduler       | **node-cron** + worker interno | Jobs agendados para sync periódico |

> **Evolução planejada (sem retrabalho de dominio):**
> 1) Separar web/worker em process groups no Fly.io
> 2) Introduzir Redis/BullMQ para throughput maior
> 3) Migrar dispatch de eventos para Kafka quando necessário

---

### Frontend

| Componente      | Tecnologia          | Justificativa                                          |
|-----------------|---------------------|--------------------------------------------------------|
| Framework       | **React + TypeScript** | Ecossistema amplo, componentes reutilizáveis        |
| Build           | **Vite**            | Rápido, moderno, HMR eficiente                         |
| State / Data    | **TanStack Query**  | Cache de servidor, background refetch, loading states  |
| State global    | **Zustand**         | Simples e leve para estado de UI                       |
| Componentes UI  | **shadcn/ui + Tailwind CSS** | Acessível, customizável, sem lock-in        |
| Charts          | **Recharts** ou **Apache ECharts** | Gráficos de série temporal e dashboards |
| Routing         | **React Router v6** | Padrão de mercado                                      |
| Forms           | **React Hook Form + Zod** | Validação type-safe no lado cliente             |

---

### DevOps & Infra

| Componente       | Tecnologia            | Justificativa                                         |
|------------------|-----------------------|-------------------------------------------------------|
| Containers       | **Docker**            | Ambiente reproduzível, deploy portável                |
| Runtime/Deploy   | **Fly.io Apps + Machines** | Deploy simples e barato para fase inicial |
| CI/CD            | **GitHub Actions**    | Nativo ao GitHub, simples, gratuito para open-source  |
| IaC              | **fly.toml + Terraform (provider Fly opcional)** | Configuração declarativa e versionável |
| Monitoramento    | **Fly Metrics + Fly Logs** | Suficiente para MVP com custo baixo |
| Logs             | **Structured JSON + fly logs/log drains** | Logs centralizados sem operar stack própria |
| Tracing          | **OpenTelemetry**     | Vendor-neutral, integra com Datadog/Jaeger/Grafana    |
| Alertas          | **Grafana Alerting / PagerDuty** | Alertas operacionais e de negócio com roteamento por time |

---

### Banco de Dados — Decisões Específicas

#### Por que PostgreSQL?
- JSONB nativo para `custom_fields` sem necessidade de schema fixo
- Extensões úteis: `pg_trgm` (busca textual), `uuid-ossp`, `pg_partman` (particionamento)
- Materialized Views para agregações pesadas de COGS e DORA
- Row-level security para isolamento multi-tenant

#### Estratégias de Performance
- Índices em: `(project_id, status)`, `(assignee_id, status)`, `(created_at DESC)`
- Particionamento de `health_metrics` e `cogs_entries` por mês (alta volumetria)
- Read replica dedicada para relatórios e exports (introduzir sob demanda)
- PgBouncer para connection pooling quando houver saturacao de conexoes

#### Migrations
- Todas gerenciadas pelo Prisma Migrate
- Convenção: nunca deletar coluna em produção na mesma migration que a remove do código
- Migrações backward-compatible obrigatórias em deploys sem downtime

---

### Segurança — Stack Específico

| Necessidade               | Solução                                               |
|---------------------------|-------------------------------------------------------|
| HTTPS / TLS               | Certificados gerenciados no Fly Proxy                |
| Autenticação              | OAuth2 (Google/Microsoft SAML) + JWT short-lived      |
| Autorização               | RBAC + Row-Level Security no PostgreSQL               |
| Credentials das APIs      | Fly Secrets + rotação por endpoint dedicado (`/integrations/connections/{id}/secrets`) |
| Validação de webhooks     | HMAC-SHA256 em todos os endpoints de webhook          |
| Dependency scanning       | Dependabot + Snyk (no CI)                             |
| SAST                      | ESLint Security Plugin + SonarQube (Fase 2+)          |
| Rate limiting             | Fastify rate-limit + controle de borda no Fly Proxy  |
| Secrets em código         | git-secrets + pre-commit hooks                        |

---

### Ferramentas de Desenvolvimento

| Ferramenta          | Uso                                          |
|---------------------|----------------------------------------------|
| pnpm                | Gerenciador de pacotes (monorepo)             |
| Turborepo           | Build system para monorepo (frontend + backend) |
| Biome               | Linting + formatting (substitui ESLint + Prettier) |
| Vitest              | Testes unitários (rápido, nativo TS)          |
| Playwright          | Testes E2E do frontend                        |
| docker-compose      | Ambiente local (Postgres; Redis opcional)     |
| Bruno / Insomnia    | Testes de API local                           |
| Conventional Commits | Padrão de mensagens → changelog automático  |

---

## Diagrama de Stack

```
[Browser / CLI]
      │
      ▼
[Fly Edge Proxy]
      │
      ▼
[Backend API (monolito modular) — Node.js/Fastify @ Fly.io]
  Auth · Rate Limit · TLS
      │
      ├──→ [Frontend App — React/Vite] (deploy em Fly.io ou CDN externo)
      │
                  └──→ [Worker interno / process group dedicado (opcional)]
               │
               ├──→ [Fly Postgres — Primary]
               │          └──→ [Read Replica — relatórios]
               │
                                           └──→ [Fly Secrets / KMS externo]

[Outbox + Jobs table no Postgres]
      ├── SyncWorker (pull JIRA/GitHub)
      ├── WebhookWorker (processar inbound events)
      └── AnalyticsWorker (calcular DORA, COGS, SLA)
```

---

## Decisões a Revisar na Fase 3+

| Decisão                    | Gatilho para revisão                                    |
|----------------------------|---------------------------------------------------------|
| Outbox (Postgres) → BullMQ | Fila > 5k jobs/h ou latencia de job > 30s por 3 dias    |
| BullMQ → Kafka             | Eventos > 50k/dia ou multiplos consumers independentes  |
| PostgreSQL → Timescale     | health_metrics > 100M rows ou queries de série temporal lentas |
| Monolito → microservices   | Times > 5 pessoas trabalhando em módulos independentes  |
| Monolito unico → web+worker separados | CPU media > 70% no app por 7 dias ou backlog crescente |
