# DORA Metrics & Health Metrics

## Visão Geral

O módulo calcula as 4 DORA metrics (padrão da indústria para medir performance de engenharia) e um conjunto extensível de métricas de saúde do time. Todos os valores são baseados em dados reais dos conectores — sem input manual.

---

## As 4 DORA Metrics

### 1. Deployment Frequency (DF)
**"Com que frequência o time faz deploy para produção?"**

| Nível DORA  | Frequência                    |
|-------------|-------------------------------|
| Elite       | Múltiplos deploys por dia     |
| High        | Entre 1 dia e 1 semana        |
| Medium      | Entre 1 semana e 1 mês        |
| Low         | Menos de 1 vez por mês        |

**Cálculo:**
- Fonte: GitHub Releases ou tags com padrão configurável (ex: `v*`, `deploy-*`)
- Janela padrão: últimos 30 dias
- Fórmula: `count(releases) / days_in_window`

```
DF = nº de releases em {janela} / dias na janela
```

**Configurações:**
- Branch de produção (default: `main`)
- Padrão de tag para contar como deploy (regex configurável)
- Excluir releases do tipo `hotfix` do count regular (opcional)

---

### 2. Lead Time for Changes (LT)
**"Quanto tempo leva desde o commit até produção?"**

| Nível DORA  | Lead Time                  |
|-------------|----------------------------|
| Elite       | < 1 hora                   |
| High        | Entre 1 dia e 1 semana     |
| Medium      | Entre 1 semana e 1 mês     |
| Low         | > 1 mês                    |

**Cálculo:**
- Fonte: GitHub Pull Requests
- Evento inicial: primeiro commit do PR (ou criação do PR — configurável)
- Evento final: merge do PR para o branch de produção
- Fórmula: `median(merge_at - first_commit_at)` nos últimos 30 dias

```
LT = percentil 50 (ou 95) de (merged_at - first_commit_at) por PR
```

**Notas:**
- Outliers (PRs abertos > 90 dias) são excluídos do cálculo médio mas listados separadamente
- Reportado em horas (P50 e P95)

---

### 3. Mean Time to Restore (MTTR)
**"Quando algo quebra em produção, quanto tempo leva para restaurar?"**

| Nível DORA  | MTTR                |
|-------------|---------------------|
| Elite       | < 1 hora            |
| High        | < 1 dia             |
| Medium      | Entre 1 dia e 1 semana |
| Low         | > 1 semana          |

**Cálculo:**
- Fonte: Tasks do tipo `bug` com prioridade `P0` ou `P1` (configurável)
- Evento inicial: `created_at` da task de bug
- Evento final: `completed_at` da task
- Fórmula: `median(completed_at - created_at)` para bugs de prod nos últimos 30 dias

```
MTTR = percentil 50 de (completed_at - created_at) por bug crítico
```

**Configuração:**
- Tags/labels que identificam "incidente de produção" (ex: `production`, `incident`, `hotfix`)
- Prioridades que entram no cálculo (default: P0, P1)
- Integração futura com PagerDuty/Opsgenie para maior precisão (Fase 4)

---

### 4. Change Failure Rate (CFR)
**"Qual % dos deploys causa problemas em produção?"**

| Nível DORA  | CFR           |
|-------------|---------------|
| Elite       | 0%–5%         |
| High        | 5%–10%        |
| Medium      | 10%–15%       |
| Low         | > 15%         |

**Cálculo:**
- Fonte: correlação entre Releases (GitHub) e bugs P0/P1 abertos logo após um deploy
- Janela de correlação: bugs abertos em até 24h após o deploy
- Fórmula: `count(deploys com bug correlacionado) / count(total deploys)`

```
CFR = deploys seguidos de bug P0/P1 em 24h / total de deploys
```

**Notas:**
- A correlação é uma heurística; integração com CI/CD checks melhora a precisão
- Hotfixes/rollbacks também contam como falha no deploy que os gerou

---

## DORA Scorecard

Agrega as 4 métricas em uma visão consolidada por projeto/team:

```
┌────────────────────────────────────────────────────────────┐
│  DORA Scorecard — Projeto: AUTH — Últimos 30 dias           │
├────────────────────────────┬──────────┬────────────────────┤
│ Métrica                    │ Valor    │ Nível              │
├────────────────────────────┼──────────┼────────────────────┤
│ Deployment Frequency       │ 1.4/day  │ ★ Elite            │
│ Lead Time for Changes      │ 18h P50  │ ▲ High             │
│ Mean Time to Restore       │ 4.2h     │ ▲ High             │
│ Change Failure Rate        │ 8%       │ ▲ High             │
├────────────────────────────┴──────────┴────────────────────┤
│ Score Geral: HIGH                                          │
└────────────────────────────────────────────────────────────┘
```

---

## Health Metrics (Além do DORA)

Métricas complementares que dão visibilidade sobre a saúde operacional do time.

### Code Review Velocity
**"Quanto tempo os PRs ficam aguardando review?"**

- Fonte: GitHub Pull Requests
- Cálculo: `median(first_review_at - created_at)` por PR nos últimos 30 dias
- Alerta: se > 24h (configurável)

---

### PR Cycle Time
**"Quanto tempo leva desde a abertura do PR até o merge?"**

- Cálculo: `median(merged_at - created_at)` por PR
- Breakdown: `wait for review + review rounds + wait for CI`

---

### PR Rejection Rate
**"Qual % dos PRs são fechados sem merge?"**

- Cálculo: `count(closed sem merge) / total PRs abertos`
- Alta rejeição pode indicar: falta de alinhamento, reviews tardias, PRs muito grandes

---

### Sprint Velocity (se JIRA ativo)
**"Quantos story points o time entrega por sprint?"**

- Cálculo: `avg(story_points_done)` nas últimas N sprints (N configurável, default: 6)
- Tendência: gráfico de velocidade sprint-a-sprint
- Alerta: queda > 20% WoW

---

### Cycle Time por Task
**"Quanto tempo uma task leva em cada etapa do workflow?"**

- Fonte: changelogs de status do JIRA
- Breakdown: `backlog → in_progress`, `in_progress → review`, `review → done`
- Identifica gargalos no fluxo de trabalho

---

### Tech Debt Ratio
**"Qual % do trabalho do time é tech debt vs features?"**

- Cálculo: `tasks tech_debt / total tasks fechadas` no período
- Meta configurável (ex: < 30%)
- Alerta: se backlog de tech_debt > 30% do total

---

### Team Load / Utilization
**"O time está sobrecarregado?"**

- Cálculo: `tasks in_progress por pessoa / WIP limit configurado`
- WIP limit default: 3 tasks simultâneas por pessoa
- Alerta: se > 110% da capacidade

---

## Cálculo e Armazenamento

Todas as métricas são calculadas de forma assíncrona pelo **Analytics Engine**:

```
[Domain Event: task.completed / pr.merged / release.published]
       │
       ▼
  Analytics Engine
  ├── recalcula métricas afetadas (DORA, SLA, velocity...)
  ├── compara com baseline e classifica (healthy/warning/critical)
  └── persiste como HealthMetric (snapshot com timestamp)

  Scheduler diário
  └── recalcula janelas deslizantes (30d, 90d)
      └── persiste HealthMetric para séries históricas
```

---

## Alertas de Health Metrics

| Métrica                  | Condição de Alerta               | Destinatário       |
|--------------------------|----------------------------------|--------------------|
| DORA Level degradado     | Nível cai 1 nível (ex: Elite → High) | CTO, Tech Manager |
| DF < baseline - 30%      | Frequência caiu muito            | Tech Manager       |
| LT > 5 dias P50          | Lead time crítico                | Tech Manager       |
| MTTR > 12h               | Tempo de restore alto            | CTO, On-call       |
| CFR > 15%                | Muitos deploys com falha         | CTO, Tech Manager  |
| Velocity queda > 20% WoW | Sprint velocity caindo           | Tech Manager       |
| Tech debt > 30% backlog  | Dívida técnica acumulando        | Tech Manager, CTO  |

---

## Extensibilidade

Novas métricas de saúde podem ser adicionadas sem alterar o schema:

1. Implementar cálculo no Analytics Engine
2. Publicar resultado como `HealthMetric` com `metric_name` único
3. Criar widget de dashboard para exibição
4. Configurar threshold para alertas

Exemplos de métricas futuras:
- `security.critical_vuln_days`: dias até patch de vulnerabilidade crítica
- `onboarding.time_to_first_pr`: tempo até primeiro PR de um novo dev
- `review.thoroughness_score`: qualidade de code reviews
- `incident.frequency_30d`: frequência de incidentes

---

## Referências

- [DORA State of DevOps Report](https://dora.dev)
- [Four Keys — Google Cloud](https://cloud.google.com/blog/products/devops-sre/using-the-four-keys-to-measure-your-devops-performance)
