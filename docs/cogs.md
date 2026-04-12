# COGS — Custo de Engenharia

## Visão Geral

O módulo de COGS (Cost of Goods Sold) traz visibilidade financeira para a área de tecnologia: quanto custa cada tarefa, épico e projeto. Permite que CTOs e Tech Managers entendam onde o capital humano está sendo investido e qual o retorno de cada iniciativa.

> COGS em tech = custo direto de entrega de software: horas de engenharia × custo/hora + overhead operacional

---

## Entidade: COGS Entry

Cada registro representa um custo associado a um período, vinculado opcionalmente a task, épico e/ou projeto.

| Campo           | Tipo        | Descrição                                                      |
|-----------------|-------------|----------------------------------------------------------------|
| `id`            | UUID        |                                                                |
| `period_date`   | date        | Data de referência (ex: dia ou semana do trabalho)             |
| `user_id`       | UUID        | FK → User (quem gerou o custo)                                 |
| `project_id`    | UUID?       | FK → Project                                                   |
| `epic_id`       | UUID?       | FK → Epic                                                      |
| `task_id`       | UUID?       | FK → Task                                                      |
| `hours_worked`  | decimal     | Horas trabalhadas no período nessa tarefa/projeto              |
| `hourly_rate`   | decimal     | Custo/hora do usuário (snapshot do momento)                    |
| `overhead_rate` | decimal     | Fator de overhead aplicado (ex: 1.3 = 30% de overhead)        |
| `total_cost`    | decimal     | `hours_worked × hourly_rate × overhead_rate`                   |
| `category`      | enum        | `engineering` \| `overhead` \| `tooling` \| `cloud` \| `other` |
| `source`        | enum        | `timetracking` \| `story_points` \| `estimate` \| `manual`    |
| `confidence`    | enum        | `high` \| `medium` \| `low`                                   |
| `is_derived`    | boolean     | `true` = gerado automaticamente da task; `false` = manual      |
| `revision`      | int         | Incrementa a cada re-geração (task reaberta e re-concluída)    |
| `superseded_at` | timestamp?  | Preenchido quando uma revisão mais nova substitui esta entrada  |
| `notes`         | string?     |                                                                |
| `approved_by`   | UUID?       | FK → User (para entradas manuais ou estimativas)               |
| `created_at`    | timestamp   |                                                                |

### Categoria `overhead`
Custos indiretos alocáveis ao time ou projeto:
- Licenças de ferramentas (JIRA, GitHub, Datadog, etc.)
- Custos de cloud associáveis a um projeto
- Custo de on-call / suporte

---

## Modelos de Cálculo

Nem todo time usa timetracking. O sistema suporta diferentes abordagens de apuração:

### Modelo 1: Story Points → Horas (estimativa)
- Usa velocidade histórica: `horas_reais_por_sp = avg(horas_reais / story_points)` das últimas N sprints
- Aplica ao SP planejado de cada task
- Confiança: `medium`

### Modelo 2: Timetracking Direto
- Integração com ferramentas de timetracking (Toggl, Harvest, Clockify — Fase 4) ou JIRA Worklogs
- Confiança: `high`

### Modelo 3: Estimativa Manual
- Input direto no sistema por task ou épico
- Confiança: `low` (auditável)

### Modelo 4: Horas por Período / Pessoa
- Se nenhuma informação granular disponível: custo total do time / período ÷ tasks no período
- Menos preciso, útil como fallback
- Confiança: `low`

---

## Derivação Automática por Iniciativa

Iniciativas (projetos com `is_initiative: true`) permitem **deriva automática de COGS** a partir das tasks concluídas ou canceladas. Isso elimina o lançamento manual para times que ainda não têm timetracking integrado.

### Trigger

A derivação ocorre quando a task muda de status para `done` ou `cancelled`. Um endpoint on-demand permite re-gerar toda a iniciativa.

### Resolução de taxa horária

Prioridade:
1. `user.hourly_rate` — taxa individual configurada pelo manager
2. `team.hourly_rate` — taxa fallback do time ao qual o assignee pertence
3. **Sem taxa** — entry é criada com `total_cost: 0`, `confidence: low` e nota explicativa (auditável, não silencioso)

### Prioridade de horas por task

| Dado disponível | `source` | `confidence` |
|---|---|---|
| `hours_actual > 0` | `timetracking` | `high` |
| `hours_estimated > 0` | `estimate` | `low` |
| `story_points × velocity` | `story_points` | `medium` |
| Nenhum | — | skip |

`velocity` = média de `hours_actual / story_points` das últimas 30 tasks concluídas no projeto.

### Tratamento de tarefas canceladas (Cost of Waste)

Tasks canceladas **com `hours_actual > 0`** geram COGS como custo de desperdício:
- `category: overhead`
- `subcategory: cancelled_task`

Tasks canceladas **sem nenhuma hora registrada** são ignoradas (nenhum custo foi incorrido).

Isso permite surfaçar o *cost of waste* — horas investidas em trabalho descartado — como métrica separada do custo de entrega.

### Re-geração ao reabrir tasks

Se uma task volta de `done` para `in_progress` e depois é concluída novamente, o sistema:
1. Marca a entrada anterior com `superseded_at = now()`
2. Cria nova entrada com `revision = N+1` e `metadata.previous_entry_id`

Entradas supersedidas são preservadas para auditoria e consultáveis via `GET /cogs/entries?superseded=true`.

---

## Agregações

### Custo por Task
```
task.total_cost = sum(cogs_entries onde task_id = task.id)
```

### Custo por Épico
```
epic.actual_cost = sum(task.total_cost para tasks do épico)
                 + sum(cogs_entries diretos no epic_id)
```

### Custo por Projeto
```
project.actual_cost = sum(epic.actual_cost)
                    + sum(cogs_entries diretos no project_id)  ← overhead de projeto
```

### Custo por Time (período)
```
team.cost_period = sum(cogs_entries onde user_id IN team.member_ids AND period = X)
```

---

## Métricas de COGS

| Métrica                      | Descrição                                                      |
|------------------------------|----------------------------------------------------------------|
| Cost per Story Point         | `total_cost / total_story_points_done` no período             |
| Cost per Feature             | Custo médio de épicos do tipo `feature` concluídos            |
| Cost per Bug (P0/P1)         | Custo de identificar + corrigir incidentes                    |
| Cost of Tech Debt            | Custo de tasks marcadas como `tech_debt`                      |
| Planned vs Actual Cost       | `estimated_cost / actual_cost` por épico                      |
| Team Burn Rate               | `custo_atual_do_mês / budget_mensal × 100` (% consumido)      |
| Engineering ROI              | Requer input de valor de negócio por épico (ver abaixo)       |

---

## ROI de Épicos

Para épicos com valor de negócio definido, o sistema calcula ROI simples:

```
epic.roi = (epic.business_value - epic.actual_cost) / epic.actual_cost × 100
```

`business_value` é um campo opcional preenchido pelo PM/CTO no épico (ex: receita esperada, custo evitado, churn reduzido).

**Caso de uso:** Priorização de roadmap com dados financeiros — "qual épico dá mais retorno pelo custo?"

---

## Dashboard de COGS

### Visão Tech Manager
- Custo por projeto no período (gráfico de barras)
- Distribuição por categoria (engineering vs overhead vs tooling)
- Planned vs Actual por épico (em andamento e concluídos)
- Burn rate do time vs budget trimestral

### Visão CTO / Executiva
- Custo total de engenharia por período
- Custo por feature release
- ROI dos últimos épicos concluídos
- Top 5 areas de maior custo (projetos/times)
- Tendência de custo por story point (eficiência operacional)

### Visão Finance / CFO
- COGS como % de receita (benchmarkável)
- Custo por produto/área de negócio
- Projeção de custo para próximo trimestre (baseada em backlog comprometido)
- Chargeback por projeto (se organização usa modelo de custo alocado)

---

## Confidencialidade

Dados de `cost_per_hour` por usuário são **sensíveis**:
- Armazenados encriptados no banco
- Acesso restrito a: `manager` e `admin` roles
- Dashboards para ICs mostram custo agregado por time — sem breakdown individual
- Logs de acesso auditáveis

---

## Desvio: Planned vs Actual

Rastrear o desvio de custo é essencial para melhorar estimativas futuras:

| Status do Épico | Como calcular                                               |
|-----------------|-------------------------------------------------------------|
| Em andamento    | `actual_cost_to_date / estimated_cost_total × 100`          |
| Concluído       | `actual_cost / estimated_cost × 100`                        |

Alertas automáticos:
- > 110% do estimado: alerta ao Tech Manager
- > 130% do estimado: alerta ao CTO

---

## Overhead de Engenharia

Além do custo de pessoas, o módulo suporta categorias de overhead:

| Categoria          | Exemplos                                          | Alocação           |
|--------------------|---------------------------------------------------|--------------------|
| `tooling`          | JIRA, GitHub Enterprise, Datadog, Sentry         | Por usuário ativo  |
| `cloud`            | AWS/GCP/Azure — ambientes não-prod               | Por projeto        |
| `onboarding`       | Tempo de rampa de novos devs                     | Por time           |
| `on_call`          | Horas de plantão fora do horário comercial       | Por time           |
| `tech_debt_rework` | Retrabalho rastreado por issue de tech_debt      | Por tarefa         |

---

## Integração com Outros Módulos

| Módulo         | Como COGS se conecta                                              |
|----------------|-------------------------------------------------------------------|
| SLAs           | Custo de violações de SLA (horas de rework + escalação)          |
| DORA Metrics   | Cost per deployment; custo de Change Failure Rate                |
| Roadmap        | COGS por épico alimenta análise de ROI do roadmap                |
| Capacity       | Custo projetado baseia a análise de capacidade do time           |
