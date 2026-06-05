# Plano do Modulo de Insights por Resource Group

Data: 2026-06-05
Status: implementado-e-revisado (A, B e C concluidas)
Foco: Tech Managers operando times no dia a dia

## 1. Objetivo

Criar um modulo de Insights orientado a Resource Groups para apoiar decisao operacional de times com base em:

1. Incidentes e impacto operacional.
2. Tendencias de entrega e estabilidade.
3. Qualidade de planejamento e confianca de roadmap.
4. Recomendacoes acionaveis para a semana.

Escopo desta fase:

1. Sem mudanca de regras de COGS.
2. Sem mudanca de regras de SLA.
3. Uso de dados ja disponiveis no Core, Integrations, DORA e Resource Groups.

## 2. Publico-alvo

1. Tech Managers.
2. Engineering Managers.
3. Staff+ apoiando operacao de multiplos times.

Perguntas que o painel precisa responder em menos de 2 minutos:

1. Onde meu grupo esta degradando?
2. Qual epico/roadmap esta menos confiavel?
3. Quanto incidentes estao impactando a entrega?
4. Qual acao devo priorizar nesta semana?

## 3. Principios de produto e arquitetura

1. Nao replicar todo o Jira ou provider externo.
2. Ingerir apenas dados necessarios para metricas, explicabilidade e recomendacao.
3. Separar claramente:
   1. dado operacional canonicamente normalizado,
   2. sinal derivado,
   3. snapshot de insight.
4. Toda recomendacao deve ter evidencia e periodo.
5. Toda metrica deve informar confianca e lacunas de dados.

## 4. Escopo funcional (MVP)

### 4.1 Overview por Resource Group

1. Score geral de saude operacional do grupo.
2. Nivel de risco: low, watch, high, critical.
3. Top 3 drivers do score.
4. Top 3 recomendacoes acionaveis.

### 4.2 Incident Insights

1. Total de incidentes (7d, 30d).
2. Distribuicao por severidade/prioridade.
3. Hotspots de servico/projeto afetado.
4. MTTA p50 e MTTR p50 quando houver integracao ativa.
5. Tendencia de frequencia de incidentes.

### 4.3 Execution Trends

1. Throughput semanal (tasks done).
2. Lead time e cycle time (quando disponivel).
3. Estabilidade de deploy (quando houver DeployEvent).
4. Anomalias de queda de entrega ou aumento de incidentes.

### 4.4 Planning Confidence

1. Confianca de planejamento por epico.
2. Confianca agregada de roadmap do grupo.
3. Qualidade de backlog (inclui itens apodrecendo e vai-e-volta).

## 5. Definicoes de metricas

### 5.1 Epic Confidence Score (0-100)

Formula orientativa:

Conf_epic = 100 - (P_scope + P_schedule + P_throughput + P_dependencies + P_backlog + P_incidents)

Componentes:

1. P_scope: crescimento de escopo apos inicio do epico.
2. P_schedule: desvio entre target_end_date e forecasted_end_date.
3. P_throughput: variabilidade recente de throughput.
4. P_dependencies: pressao de bloqueios em tarefas do epico.
5. P_backlog: degradacao por backlog quality.
6. P_incidents: penalidade por incidentes correlacionados ao epico/grupo.

### 5.2 Roadmap Confidence (grupo)

1. Agregacao ponderada dos Epic Confidence.
2. Pesos iniciais por story points restantes do epico.
3. Campos principais:
   1. confidence_score,
   2. confidence_trend,
   3. on_track_ratio,
   4. delayed_epics_count.

### 5.3 Backlog Quality (grupo)

Metas: sinalizar backlog apodrecendo e churn de fluxo.

Indicadores MVP:

1. Backlog Aging Index: mediana de idade de tasks em backlog/todo.
2. Stale Backlog Rate: percentual sem atualizacao acima de X dias.
3. Overdue Backlog Rate: percentual com due_date vencido e nao concluido.
4. Flow Regression Rate (vai-e-volta proxy): tasks abertas com completedAt preenchido.
5. Backlog Churn Proxy: tarefas de backlog/todo com excesso de mudancas recentes (via updatedAt).

Observacao:

1. Sem historico de transicao de status, vai-e-volta e aproximado.
2. Proposta fase 2: adicionar log leve de transicoes para precisao.

### 5.4 Incident Impact on Delivery

1. Incident Load: volume no periodo.
2. Incident Time Impact: proxy de horas de impacto por incidente.
3. Impacted Epics Count: epicos com janela impactada por incidente.
4. Roadmap Incident Pressure: nivel agregado de impacto no grupo.

Regra inicial de correlacao:

1. Match por projeto/servico do Resource Group contra affectedServices.
2. Janela temporal do incidente sobreposta ao periodo ativo do epico.

## 6. Dados disponiveis hoje e lacunas

### 6.1 Ja disponivel

1. Resource Group com vinculos de projetos e times.
2. IncidentEvent (openedAt, acknowledgedAt, resolvedAt, severity, affectedServices).
3. DORA por Resource Group e MTTR no scorecard quando integracao ativa.
4. Task/Epic com status, datas, story points, estimativas, dependencias.
5. HealthMetric e DeployEvent para sinais de tendencia.

### 6.2 Lacunas conhecidas

1. Sem historico completo de transicao de status da task.
2. Reabertura exata e tempo em estado ficam por proxy no MVP.
3. Alguns campos de provider podem variar em qualidade por tenant.

## 7. Contratos de API propostos (v1)

1. GET /api/v1/insights/resource-groups/:group_id/overview
2. GET /api/v1/insights/resource-groups/:group_id/incidents
3. GET /api/v1/insights/resource-groups/:group_id/trends
4. GET /api/v1/insights/resource-groups/:group_id/planning-confidence
5. POST /api/v1/insights/resource-groups/:group_id/recompute

Permissoes propostas:

1. insights.read
2. insights.recompute

Envelope padrao:

1. Sucesso: data + meta + error nulo.
2. Erro: data nulo + meta + error com code/message/details.

## 8. Modelo de persistencia proposto

1. ResourceGroupInsightSnapshot
   1. tenantId
   2. resourceGroupId
   3. periodKey
   4. generatedAt
   5. healthScore
   6. riskLevel
   7. summaryPayload (json)
2. ResourceGroupInsightSignal
   1. snapshotId
   2. dimension
   3. metricName
   4. value
   5. trend
   6. confidence
   7. sourceLineage
3. ResourceGroupInsightRecommendation
   1. snapshotId
   2. type
   3. priority
   4. message
   5. context

## 9. Roadmap de implementacao

### Sprint A - Foundation

1. Definir contratos OpenAPI do modulo Insights.
2. Criar schemas Prisma do modulo Insights.
3. Implementar endpoint overview com Incident + Execution basicos.
4. Implementar calculo inicial de health_score e risk_level.
5. Criar testes de contrato e regras de permissao.

### Sprint B - Planning Confidence

1. Implementar Epic Confidence e Roadmap Confidence.
2. Implementar Backlog Quality com proxies.
3. Implementar endpoint planning-confidence.
4. Expor drivers e explicabilidade dos scores.
5. Incluir recomendacoes acionaveis v1.

### Sprint C - Trends e Operacao

1. Implementar endpoint trends com anomalias e degradacao.
2. Adicionar recompute assinado por worker (fase 2: hardening operacional com fila dedicada).
3. Persistir snapshots periodicos.
4. Ajustar observabilidade (latencia, falhas, freshness).
5. Preparar handoff frontend final.

Status Sprint C (2026-06-05):

1. Endpoints trends e recompute implementados e testados.
2. Freshness e data_quality_warnings expostos no overview.
3. Snapshot persistence ativa para overview, trends e recompute.
4. Fluxo atual de recompute retorna 202 queued com protecao de conflito 409.
5. Worker dedicado com fila persistente permanece como evolucao de hardening (fase 2).

## 10. Criterios de aceite

1. Tech Manager identifica em uma tela:
   1. risco atual,
   2. confianca de roadmap,
   3. impacto de incidentes,
   4. acoes recomendadas.
2. Toda recomendacao traz evidencia com periodo e metrica.
3. Backlog apodrecendo e vai-e-volta aparecem no score de planejamento.
4. DORA por grupo e MTTR continuam reutilizados sem alterar COGS/SLA.
5. Falta de dados nao gera falso zero; exibe nivel de confianca e warning.

## 11. Riscos e mitigacoes

1. Risco: ruido por proxies de backlog sem historico de transicao.
   1. Mitigacao: thresholds conservadores e confidence baixo quando faltar sinal.
2. Risco: variacao de qualidade dos dados de integracao entre tenants.
   1. Mitigacao: data-quality flags por metrica e fallback explicito.
3. Risco: acoplamento excessivo com Intel.
   1. Mitigacao: extrair funcoes compartilhadas para camada analitica comum.
4. Risco: pausa eventual de jobs em ambiente Fly.io com `min_machines_running = 0`.
   1. Mitigacao: risco aceito no MVP para otimizar custo; hardening de fase 2 deve adotar worker dedicado sempre ativo para processamento assíncrono crítico.

## 12. Nao-objetivos desta fase

1. Nao implementar BI financeiro detalhado (COGS profundo).
2. Nao alterar engine de SLA nem modelo de avaliacao de SLA.
3. Nao replicar payload completo do Jira/GitHub/Opsgenie/incident.io.

## 13. Gate backend para liberar frontend (obrigatorio)

Checklist oficial por sprint:

1. docs/frontend/insights-backend-validation-gate-checklist.md

Regra de execucao:

1. Sprint A fecha com contrato revisado contra codigo implementado.
2. Sprint B so inicia apos Sprint A aprovada e corrigida.
3. Sprint C so inicia apos Sprint B aprovada e corrigida.
4. Frontend implementa somente sprint aprovada no gate correspondente.
