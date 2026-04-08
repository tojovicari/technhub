# CTO.ai — Plataforma de Gestão de Área de Tech

> Centraliza dados de JIRA e GitHub para fornecer **visibilidade operacional e estratégica** em tempo real para Tech Managers, CTOs e lideranças técnicas.

---

## O Problema

Líderes de tecnologia tomam decisões com dados fragmentados:
- Métricas de delivery no JIRA
- Saúde do código no GitHub
- Custos numa planilha
- SLAs em outro sistema
- DORA metrics... em nenhum lugar

O CTO.ai unifica tudo isso em uma plataforma modular, extensível e orientada a decisão.

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
cto_ai/
├── README.md                   ← você está aqui
├── SISTEMA_GESTAO_TECH.md      ← documento original de planejamento
├── .github/
│   ├── copilot-instructions.md ← guardrails de arquitetura para IA
│   ├── instructions/
│   │   └── project-context.instructions.md
│   ├── skills/
│   │   ├── module-contracts/SKILL.md
│   │   └── cto-metrics-planning/SKILL.md
│   └── prompts/
│       └── contract-review.prompt.md
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

## Contexto e Skills de IA

- `copilot-instructions.md`: instrucoes sempre ativas com regras de modularidade e contract-first.
- `project-context.instructions.md`: contexto global do produto e heuristicas de decisao.
- Skill `module-contracts`: desenhar/revisar contratos API/eventos entre modulos.
- Skill `cto-metrics-planning`: estruturar DORA, SLA, COGS e scorecards executivos.
- Prompt `contract-review.prompt.md`: revisar mudancas com foco em boundary safety e compatibilidade.
