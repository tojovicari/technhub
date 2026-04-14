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

**Fonte de dados:** Integração de incident management — **OpsGenie** ou **incident.io**.

> A fonte anterior (tasks JIRA do tipo `bug`) foi **descontinuada**. O JIRA introduzia imprecisão de 20–60% porque o ticket abria depois do incidente começar e fechava de forma independente da restauração do serviço. MTTR só é reportado quando uma integração de incident management está ativa e configurada.

**Cálculo:**
- Fonte: `IncidentEvent` com `resolvedAt` preenchido e `priority` dentro de `include_priorities` (default: P1, P2)
- Evento inicial: `openedAt` — timestamp que o provider capturou como início do incidente (configurável via field mapping: pode ser `created_at` ou `impactStartDate`)
- Evento final: `resolvedAt` — quando o serviço foi restaurado
- Fórmula: `median(resolvedAt - openedAt)` nos últimos 30 dias

```
MTTR = percentil 50 de (resolvedAt - openedAt) por incidente P1/P2
```

**Escopo de serviço:**
- Se o incidente tiver `affectedServices` preenchido e esses serviços forem reconhecidos (matched) a `Project` do core, o MTTR pode ser filtrado por projeto.
- Se não houver match de serviço, o incidente entra no cálculo de MTTR **genérico** (cross-projeto, tenant-wide). É preferível ter um MTTR genérico preciso a não ter MTTR.
- O auto-match é feito por nome: `affectedServices[]` do `IncidentEvent` é comparado contra os nomes e keys dos `Project` ativos do tenant (case-insensitive).

**Quando não configurado:**
- `mttr: null`, `mttr_source: "not_configured"`
- A API retorna uma mensagem de CTA orientando a configurar uma integração

**Configuração (via field mapping da connection):**
- `severity_to_priority`: mapa de nomes de severity do provider → P1-P5
- `include_priorities`: quais prioridades entram no cálculo (default: `["P1", "P2"]`)
- `opened_at_field`: qual timestamp usar como início (`created_at` ou `impactStartDate`)
- `affected_service_field`: de onde extrair o serviço afetado

Ver detalhes completos em [incident-integrations-plan.md](./incident-integrations-plan.md).

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
- Com integração de incident management ativa, a correlação usa `IncidentEvent.openedAt` vs timestamp do deploy mais recente — mais precisa que a heurística de bug JIRA
- Sem integração, a correlação continua como heurística (incidente detectado = P0/P1 bug JIRA aberto em < 24h após deploy) — única métrica DORA que ainda pode usar JIRA como fallback
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

> **MTTR requer integração de incident management.** Quando não configurada, o scorecard exibe o campo como `—` com indicação de setup, e o score geral é calculado sobre as 3 métricas restantes.

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

### MTTA (Mean Time to Acknowledge) — requer incident management
**"Quando um incidente começa, quanto tempo leva até o primeiro responder agir?"**

- Fonte: `IncidentEvent.acknowledgedAt` e `IncidentEvent.openedAt`
- Cálculo: `median(acknowledgedAt - openedAt)` por incidente P1/P2 nos últimos 30 dias
- Disponível apenas quando integração de incident management ativa
- Não é uma métrica DORA oficial — exibida como health metric complementar
- Alerta: se MTTA P50 > 30 min (configurável)

```
MTTA = percentil 50 de (acknowledgedAt - openedAt) por incidente P1/P2
```

---

### Incident Frequency — requer incident management
**"Com que frequência incidentes de produção acontecem?"**

- Fonte: `IncidentEvent` com `priority` em `include_priorities` (P1/P2)
- Cálculo: `count(incidentes) / dias na janela` (default: 30 dias)
- Não é uma métrica DORA oficial — complementa o CFR com volume absoluto
- Exibida lado a lado com o CFR no health scorecard
- Alerta: se frequency > baseline da semana anterior em > 50%

```
Incident Frequency = count(IncidentEvent P1/P2) / dias na janela
```

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

| Métrica                  | Condição de Alerta                         | Destinatário       |
|--------------------------|--------------------------------------------|--------------------|  
| DORA Level degradado     | Nível cai 1 nível (ex: Elite → High)       | CTO, Tech Manager  |
| DF < baseline - 30%      | Frequência caiu muito                      | Tech Manager       |
| LT > 5 dias P50          | Lead time crítico                          | Tech Manager       |
| MTTR > 12h               | Tempo de restore alto                      | CTO, On-call       |
| MTTR not_configured      | Sem integração de incident management      | CTO, Tech Manager  |
| MTTA > 30min             | Resposta ao incidente lenta                | CTO, On-call       |
| CFR > 15%                | Muitos deploys com falha                   | CTO, Tech Manager  |
| Incident Frequency spike | Frequência > 150% da baseline semanal      | CTO, On-call       |
| Velocity queda > 20% WoW | Sprint velocity caindo                     | Tech Manager       |
| Tech debt > 30% backlog  | Dívida técnica acumulando                  | Tech Manager, CTO  |

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

Métricas já implementadas via incident integrations (OpsGenie / incident.io):
- `incident.mttr`: MTTR preciso por incidente real (substitui heurística JIRA)
- `incident.mtta`: tempo até primeiro acknowledge
- `incident.frequency_30d`: frequência de incidentes P1/P2 na janela

---

## Referências

- [DORA State of DevOps Report](https://dora.dev)
- [Four Keys — Google Cloud](https://cloud.google.com/blog/products/devops-sre/using-the-four-keys-to-measure-your-devops-performance)
