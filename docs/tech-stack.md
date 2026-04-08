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
| Cache / Filas   | **Redis**           | Cache de API, filas de webhook (Bull/BullMQ), contadores         |
| Message Bus     | **BullMQ (Redis)**  | Simples para começar, sem infra adicional (usa Redis já presente)|
| Autenticação    | **OAuth2 + JWT**    | Padrão de mercado; integra com Google/Microsoft para SSO         |
| Secrets         | **HashiCorp Vault** ou **AWS Secrets Manager** | Credentials do JIRA/GitHub jamais no código |
| Scheduler       | **node-cron** + **BullMQ repeatables** | Jobs agendados para sync periódico |

> **Alternativa para Fase 4+**: se o volume de eventos crescer significativamente, avaliar migração do Message Bus para **Apache Kafka**.

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
| Orquestração     | **Kubernetes (EKS/GKE)** | Escala horizontal, health checks, rolling deploys  |
| CI/CD            | **GitHub Actions**    | Nativo ao GitHub, simples, gratuito para open-source  |
| IaC              | **Terraform**         | Declarativo, versionável, multi-cloud                 |
| Monitoramento    | **Prometheus + Grafana** | Padrão open-source para métricas de infra          |
| Logs             | **Structured JSON → CloudWatch / ELK** | Logs estruturados desde o início      |
| Tracing          | **OpenTelemetry**     | Vendor-neutral, integra com Datadog/Jaeger/Grafana    |
| Alertas          | **Alertmanager**      | Integra com Prometheus; rota para Slack/PagerDuty     |

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
- Read replica dedicada para relatórios e exports
- PgBouncer para connection pooling em produção

#### Migrations
- Todas gerenciadas pelo Prisma Migrate
- Convenção: nunca deletar coluna em produção na mesma migration que a remove do código
- Migrações backward-compatible obrigatórias em deploys sem downtime

---

### Segurança — Stack Específico

| Necessidade               | Solução                                               |
|---------------------------|-------------------------------------------------------|
| HTTPS / TLS               | Certificados via Let's Encrypt + cert-manager (k8s)   |
| Autenticação              | OAuth2 (Google/Microsoft SAML) + JWT short-lived      |
| Autorização               | RBAC + Row-Level Security no PostgreSQL               |
| Credentials das APIs      | HashiCorp Vault ou AWS Secrets Manager                |
| Validação de webhooks     | HMAC-SHA256 em todos os endpoints de webhook          |
| Dependency scanning       | Dependabot + Snyk (no CI)                             |
| SAST                      | ESLint Security Plugin + SonarQube (Fase 2+)          |
| Rate limiting             | nginx / Kong no API Gateway                           |
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
| docker-compose      | Ambiente local (Postgres, Redis, etc.)        |
| Bruno / Insomnia    | Testes de API local                           |
| Conventional Commits | Padrão de mensagens → changelog automático  |

---

## Diagrama de Stack

```
[Browser / CLI]
      │
      ▼
[CDN — CloudFront/Fastly]
      │
      ▼
[API Gateway — Kong ou nginx]
  Auth · Rate Limit · TLS
      │
      ├──→ [Frontend App — React/Vite] (servido via CDN)
      │
      └──→ [Backend API — Node.js/Fastify]
               │
               ├──→ [PostgreSQL — Primary]
               │          └──→ [Read Replica — relatórios]
               │
               ├──→ [Redis — Cache + BullMQ Queues]
               │
               └──→ [HashiCorp Vault — Secrets]

[BullMQ Workers] ←→ Redis
  ├── SyncWorker (pull JIRA/GitHub)
  ├── WebhookWorker (processar inbound events)
  └── AnalyticsWorker (calcular DORA, COGS, SLA)
```

---

## Decisões a Revisar na Fase 3+

| Decisão                    | Gatilho para revisão                                    |
|----------------------------|---------------------------------------------------------|
| BullMQ → Kafka             | Eventos > 10k/dia ou múltiplos consumers independentes  |
| PostgreSQL → Timescale     | health_metrics > 100M rows ou queries de série temporal lentas |
| Monolito → microservices   | Times > 5 pessoas trabalhando em módulos independentes  |
| Self-hosted → managed PaaS | Custo de ops > custo de managed (RDS, ElastiCache, etc.)|
