# moasy.tech — Plataforma de Gestão de Área de Tech

> Centraliza dados de JIRA e GitHub para fornecer **visibilidade operacional e estratégica** em tempo real para Tech Managers, CTOs e lideranças técnicas.

---

## O Problema

Líderes de tecnologia tomam decisões com dados fragmentados:
- Métricas de delivery no JIRA
- Saúde do código no GitHub
- Custos numa planilha
- SLAs em outro sistema
- DORA metrics... em nenhum lugar

O moasy.tech unifica tudo isso em uma plataforma modular, extensível e orientada a decisão.

---

## Público-Alvo

| Persona         | Principal necessidade                                      |
|-----------------|------------------------------------------------------------|
| CTO             | Visão executiva, DORA, custo de engenharia, risco          |
| Tech Manager    | Saúde do time, SLAs, COGS por projeto, capacity           |
| Staff Engineer  | Tech debt, qualidade, dependências                        |
| Finance/CFO     | COGS, ROI de épicos, burn rate de squads                  |

---

## Estrutura do Projeto

```
moasy_tech/
├── README.md                   ← você está aqui
├── SISTEMA_GESTAO_TECH.md      ← documento original de planejamento
├── .github/
│   ├── copilot-instructions.md ← guardrails de arquitetura para IA
│   ├── instructions/
│   │   └── project-context.instructions.md
│   ├── skills/
│   │   ├── module-contracts/SKILL.md
│   │   ├── cto-metrics-planning/SKILL.md
│   │   ├── contract-governance/SKILL.md
│   │   └── frontend-api-doc-governance/SKILL.md
│   └── prompts/
│       ├── contract-review.prompt.md
│       └── contract-governance-check.prompt.md
└── docs/
    ├── architecture.md         ← visão geral de arquitetura
    ├── integrations.md         ← módulo de integrações (JIRA, GitHub...)
    ├── entities.md             ← domain model: entidades e relacionamentos
    ├── slas.md                 ← SLAs, compliance e alertas
    ├── dora-metrics.md         ← DORA metrics e health metrics
    ├── cogs.md                 ← custo de engenharia (COGS)
    ├── roadmap.md              ← fases e milestones do projeto
    ├── tech-stack.md           ← decisões de tecnologia
    └── openapi/
        ├── core-v1.yaml        ← contratos Core (teams, projects, epics, tasks)
        ├── iam-v1.yaml         ← contratos IAM (roles, perfis e atribuições)
        ├── integrations-v1.yaml← contratos integrações + rotação de secrets
        └── authorization-policy-v1.yaml ← contrato transversal de autorização backend
```

---

## Princípios de Design

| Princípio       | Descrição                                                                  |
|-----------------|----------------------------------------------------------------------------|
| Extensibilidade | Novas integrações adicionadas sem refatorar o core                        |
| Isolamento      | Cada módulo é deployável e testável de forma independente                 |
| Observabilidade | Logs, métricas e traces em cada camada                                    |
| Composição      | Dashboards são compostos de widgets de múltiplos módulos                  |
| Data First      | Decisões com base em dados rastreáveis, com lineage claro                 |

---

## Fases do Projeto

| Fase | Nome                   | Semanas | Entregável Principal                              |
|------|------------------------|---------|---------------------------------------------------|
| 1    | MVP Core               | 1–4     | Dados JIRA+GitHub ingestados + dashboard básico   |
| 2    | Métricas & SLAs        | 5–8     | DORA metrics, SLA compliance, alertas             |
| 3    | COGS & Custos          | 9–12    | Custo por task/epic, analytics financeiro         |
| 4    | Inteligência & Previsão| 13–16   | Forecasts, anomaly detection, recomendações       |

Ver detalhes completos em [docs/roadmap.md](docs/roadmap.md).

---

## Módulos

### 🔌 [Integrações](docs/integrations.md)
Conectores para JIRA e GitHub com suporte a pull (scheduler) e push (webhooks). Arquitetura extensível via `BaseConnector` para adicionar novos providers.

### 🗂 [Entidades](docs/entities.md)
Domain model com User, Project, Task, Epic, Team, SLA, HealthMetric e COGS Entry. Rastreabilidade completa desde a origem (JIRA/GitHub) até as agregações.

### 📏 [SLAs](docs/slas.md)
Templates de SLA por tipo e prioridade de tarefa. Monitoramento em tempo real, histórico de compliance, alertas de violação e escalation rules.

### 📊 [DORA Metrics & Health](docs/dora-metrics.md)
As 4 DORA metrics (Deployment Frequency, Lead Time, MTTR, Change Failure Rate) mais métricas de saúde do time: cycle time, review velocity, tech debt ratio.

### 💰 [COGS](docs/cogs.md)
Custo de engenharia por task, épico e projeto. Correlação entre esforço planejado vs real. ROI de épicos e burn rate de squads.

### 🏗 [Arquitetura](docs/architecture.md)
Visão estrutural do sistema, camadas, fluxo de dados e decisões arquiteturais.

### 🛠 [Tech Stack](docs/tech-stack.md)
Decisões de tecnologia com justificativas.

---

## Critérios de Sucesso Gerais

- 📦 Sync de dados JIRA/GitHub com latência < 5 minutos
- 📊 DORA metrics com precisão > 90%
- 💰 COGS por task acurado ±5%
- 🎯 Forecasts com accuracy > 80% (Fase 4)
- 🔒 Isolamento de dados por team (row-level security)

---

## Status do Projeto

> 🟡 Em planejamento — Fase 1 não iniciada

---

## Desenvolvimento Local (Backend)

Backend inicial em [apps/api](apps/api) com Node.js + Fastify + Prisma.

### 1) Instalar dependências

```bash
npm --prefix apps/api install
```

### 2) Configurar ambiente local

```bash
cp apps/api/.env.example apps/api/.env
```

### 3) Banco local

Opcao A (Docker Compose):

```bash
npm run db:up
```

Opcao B (Postgres local ja instalado):
- garantir um banco `moasy_tech` local
- manter `DATABASE_URL` no [apps/api/.env](apps/api/.env)

### 4) Controle de datamodel e migration

```bash
npm run api:prisma:migrate:dev -- --name init
npm run api:prisma:generate
```

Pratica recomendada:
- toda alteracao no [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma) deve gerar migration versionada
- nunca alterar estrutura manualmente em producao sem migration correspondente
- em deploy, aplicar com `npm run api:prisma:migrate:deploy`

### 5) Rodar API local

```bash
npm run api:dev
```

Endpoints iniciais:
- [apps/api/src/app.ts](apps/api/src/app.ts): `GET /health`
- [apps/api/src/app.ts](apps/api/src/app.ts): `GET /ready`

### 6) Auth local (JWT)

As rotas de API em `/api/v1/*` exigem JWT por padrao.

Claims minimas esperadas:
- `sub`
- `tenant_id`
- `roles[]`
- `permissions[]`

Permissoes de Integrations usadas no backend:
- `integrations.connection.manage`
- `integrations.secret.rotate`
- `integrations.sync.trigger`
- `integrations.sync.read`
- `integrations.webhook.read`

Permissoes de Core usadas no backend:
- `core.team.manage`
- `core.project.manage`
- `core.project.read`
- `core.epic.manage`
- `core.epic.read`
- `core.task.write`
- `core.task.read`

Em desenvolvimento local, e possivel bypass temporario com:

```bash
AUTH_BYPASS=true
```

Mantendo `AUTH_BYPASS=false` (padrao), gere um token HS256 de teste com o mesmo `JWT_SECRET` do `.env`.

### 7) Webhooks locais

Webhooks usam token de provider no header `x-webhook-token`:
- `GITHUB_WEBHOOK_TOKEN`
- `JIRA_WEBHOOK_TOKEN`

O worker interno de webhooks roda em polling com `WEBHOOK_WORKER_INTERVAL_MS` e consome a fila persistida em Postgres.

---

## Contexto e Skills de IA

- `copilot-instructions.md`: instrucoes sempre ativas com regras de modularidade e contract-first.
- `project-context.instructions.md`: contexto global do produto e heuristicas de decisao.
- Skill `module-contracts`: desenhar/revisar contratos API/eventos entre modulos.
- Skill `cto-metrics-planning`: estruturar DORA, SLA, COGS e scorecards executivos.
- Skill `contract-governance`: validar consistencia de APIs, permissoes, payloads e documentacao.
- Skill `frontend-api-doc-governance`: garantir documentacao frontend-ready para endpoints, payloads, permissoes, statuses e compatibilidade.
- Prompt `contract-review.prompt.md`: revisar mudancas com foco em boundary safety e compatibilidade.
- Prompt `contract-governance-check.prompt.md`: gate rapido para PRs com alteracoes de contrato/autorizacao.
- PR Template `.github/pull_request_template.md`: checklist obrigatorio de API docs/permissoes/payloads.
- Workflow `.github/workflows/frontend-api-doc-governance.yml`: bloqueia PR com mudanca de API externa sem checklist/documentacao minima.
