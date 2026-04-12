# Roadmap de Desenvolvimento

## Princípios

- Cada fase entrega valor independente — nada fica "na gaveta" esperando a próxima fase
- Fases são sequenciais mas com sobreposição no final de cada uma (handoff/estabilização)
- A Fase 1 é a fundação: qualidade de dados > quantidade de features

---

## Visão Geral das Fases

```
Semanas  1    2    3    4    5    6    7    8    9    10   11   12   13   14   15   16
         ┌────────────────────┐
Fase 1   │  MVP Core          │──┐
         └────────────────────┘  │ estab.
                          ┌──────┴──────────────┐
Fase 2                    │  Métricas & SLAs     │──┐
                          └─────────────────────-┘  │ estab.
                                            ┌────────┴────────────┐
Fase 3                                      │  COGS & Custos       │──┐
                                            └─────────────────────-┘  │ estab.
                                                              ┌────────┴─────────┐
Fase 4                                                        │  Inteligência     │
                                                              └──────────────────┘
```

---

## Fase 1 — MVP Core (Semanas 1–4)

**Objetivo:** Ingestar dados reais de JIRA e GitHub e exibir o estado atual de projetos e times.

**Entregáveis:**

| # | Tarefa                                           | Prioridade |
|---|--------------------------------------------------|------------|
| 1.1 | Setup de infraestrutura Fly.io (app unica + Postgres + API skeleton) | P0       |
| 1.2 | Connector JIRA: autenticação + sync de projetos, issues, epics, users | P0 |
| 1.3 | Connector GitHub: autenticação + sync de repos, issues, PRs, users | P0 |
| 1.4 | Webhook receiver (JIRA + GitHub) com fila assíncrona em Postgres (jobs/outbox) | P1     |
| 1.5 | Domain model completo: User, Team, Project, Task, Epic | P0    |
| 1.6 | Unificação de usuários JIRA ↔ GitHub por email   | P1         |
| 1.7 | API REST: CRUD de entidades core                 | P0         |
| 1.8 | Dashboard básico: status por projeto, tasks por assignee | P0  |
| 1.9 | Autenticação: OAuth2 + JWT                       | P0         |
| 1.10 | Documentação de API (OpenAPI spec)              | P1         |
| 1.11 | IAM: Permission Profiles + RBAC por tenant      | P0         |

**Critérios de Aceitação da Fase 1:**
- [ ] Sync full de JIRA e GitHub completado sem erros em ambiente de staging
- [ ] Ambiente de staging ativo no Fly.io com deploy automatizado via GitHub Actions
- [ ] Latência de sync < 5 minutos (pull model)
- [ ] Webhooks processados em < 30 segundos
- [ ] Custo mensal da infra base <= USD 40 no primeiro ciclo
- [ ] Dashboard exibe status atual dos projetos integrados
- [ ] Zero dados duplicados após múltiplos syncs
- [ ] 90%+ de cobertura em testes unitários dos transformers/connectors

---

## Fase 2 — Métricas & SLAs (Semanas 5–8)

**Objetivo:** Estabelecer baselinas mensuráveis de performance e compliance operacional.

**Entregáveis:**

| # | Tarefa                                                  | Prioridade |
|---|---------------------------------------------------------|------------|
| 2.1 | Analytics Engine: estrutura base + consumo de eventos | P0         |
| 2.2 | DORA: Deployment Frequency                             | P0         |
| 2.3 | DORA: Lead Time for Changes                            | P0         |
| 2.4 | DORA: Mean Time to Restore                             | P0         |
| 2.5 | DORA: Change Failure Rate                              | P0         |
| 2.6 | DORA Scorecard no dashboard (nível Elite/High/Medium/Low) | P0      |
| 2.7 | SLA Templates: CRUD + configuração por projeto         | P0         |
| 2.8 | SLA Engine: cálculo de at_risk e breach               | P0         |
| 2.9 | Alertas Slack/Email: SLA at_risk e violações          | P1         |
| 2.10 | Health Metrics: cycle time, review velocity, tech debt ratio | P1  |
| 2.11 | Dashboard Executivo: DORA scorecard + SLA compliance  | P1         |
| 2.12 | Séries temporais de métricas (histórico 90 dias)      | P1         |
| 2.13 | Relatório semanal automatizado (Slack digest)         | P2         |

**Critérios de Aceitação da Fase 2:**
- [ ] 4 DORA metrics calculadas com precisão verificada manualmente
- [ ] SLAs configurados e monitorados para pelo menos 1 projeto real
- [ ] Algum alerta real disparado e validado
- [ ] Histórico de 30 dias de HealthMetrics armazenado

---

## Fase 3 — COGS & Custos (Semanas 9–12)

**Objetivo:** Dar visibilidade financeira ao custo da área de engenharia.

**Entregáveis:**

| # | Tarefa                                                       | Prioridade |
|---|--------------------------------------------------------------|------------|
| 3.1 | COGS Entry: modelo + API de input (manual + estimativa)    | P0         |
| 3.2 | Cálculo de custo por story points (modelo de estimativa)   | P0         |
| 3.3 | Rollup: custo por task → épico → projeto                   | P0         |
| 3.4 | Burn rate do time vs budget configurado                    | P0         |
| 3.5 | Planned vs Actual: desvio de custo por épico               | P1         |
| 3.6 | Dashboard CFO/CTO: custo por projeto, burn rate, top custos| P0         |
| 3.7 | ROI de épicos (requer business_value no epic)              | P1         |
| 3.8 | Alertas: > 110% e > 130% do custo estimado                 | P1         |
| 3.9 | Overhead tracking: tooling, cloud, on-call                 | P2         |
| 3.10 | Relatório mensal de COGS (PDF/email)                      | P2         |
| 3.11 | Controle de acesso: dados de custo/hora por role          | P0         |

**Critérios de Aceitação da Fase 3:**
- [ ] Custo por task calculado e auditável (com rastreabilidade da origem)
- [ ] Burn rate atualizado diariamente com precisão
- [ ] COGS por projeto exibido no dashboard
- [ ] Dados sensíveis (hourly_rate) inacessíveis para roles não autorizados

---

## Fase 4 — Inteligência & Previsão (Semanas 13–16)

**Objetivo:** Insights preditivos e recomendações acionáveis para decisões proativas.

**Entregáveis:**

| # | Tarefa                                                        | Prioridade | Status |
|---|---------------------------------------------------------------|------------|--------|
| 4.1 | Forecast de sprint velocity (regressão simples sobre histórico) | P0      | ✅ Implementado |
| 4.2 | Estimativa de término de épico (baseada em velocity e tasks restantes) | P0 | ✅ Implementado |
| 4.3 | Risk scoring: probabilidade de SLA breach                    | P1         | ✅ Implementado |
| 4.4 | Anomaly detection: alertas proativos de degradação de métricas| P1        | ✅ Implementado |
| 4.5 | Recomendações automáticas (ex: "time sobrecarregado", "epic atrasado") | P1 | ✅ Implementado |
| 4.6 | Roadmap timeline visual (Gantt leve)                         | P1         | ✅ Implementado (`GET /intel/roadmap`) |
| 4.7 | Dependency tracking entre tasks/épicos                       | P2         | ✅ Implementado (`GET /intel/dependencies` + writes em Core) |
| 4.8 | Dashboard de capacity (FTE disponível vs comprometido)       | P1         | ✅ Implementado (`GET /intel/capacity`) |
| 4.9 | Custom dashboard builder (drag-drop widgets)                 | P2         | ❌ Pós-fase (frontend only) |
| 4.10 | Export de dados: CSV, API aberta para BI tools              | P2         | ✅ Implementado (`GET /intel/export`) |
| 4.11 | Integração PagerDuty/Opsgenie (MTTR aprimorado)             | P3         | ❌ Backlog futuro |
| 4.12 | Skill matrix do time                                         | P3         | ❌ Backlog futuro |

**Critérios de Aceitação da Fase 4:**
- [ ] Forecasts com accuracy > 80% medida retroativamente
- [ ] Anomaly detection com < 10% de falsos positivos
- [x] API pública documentada e versionada (v1)

---

## Backlog Futuro (Pós-Fase 4)

Itens identificados mas fora do escopo das 4 fases iniciais:

| Item                                          | Justificativa para adiar        |
|-----------------------------------------------|---------------------------------|
| Integração SonarQube / Code Climate           | Requer connector adicional       |
| OKR Module                                    | Depende de alinhamento org       |
| White-label / Multi-tenant                    | Escala necessária após MVP       |
| Mobile app                                    | Web-first primeiro               |
| Integração Linear / Azure DevOps              | JIRA/GitHub cobrem maioria       |
| Retrospective templates                       | Menos crítico para core do produto |
| Chargeback automático (billing)               | Implica integração financeira    |

---

## Dependências Entre Fases

```
Fase 2 depende de → Fase 1 (dados sincronizados + domain model)
Fase 3 depende de → Fase 1 (users com cost_per_hour) + Fase 2 (story points/tasks validados)
Fase 4 depende de → Fase 2 (séries históricas de métricas) + Fase 3 (COGS histórico)
```

---

## Riscos e Mitigações

| Risco                                          | Probabilidade | Impacto | Mitigação                                           |
|------------------------------------------------|---------------|---------|-----------------------------------------------------|
| Qualidade dos dados JIRA/GitHub inconsistente  | Alta          | Alto    | Validação + relatório de data quality na Fase 1     |
| Usuários sem email para unificação             | Média         | Médio   | Matching manual por nome + fallback                 |
| Cost_per_hour não disponível                   | Média         | Médio   | Custo agregado por time sem breakdown individual    |
| Rate limit das APIs externas                   | Baixa         | Médio   | Backoff + priorização de webhooks sobre pull        |
| Adoção baixa por falta de valor percebido      | Média         | Alto    | Entrevistas com usuários antes da Fase 2            |
| Scope creep nas fases intermediárias           | Alta          | Médio   | Backlog rigoroso; features extras no "Backlog Futuro"|
