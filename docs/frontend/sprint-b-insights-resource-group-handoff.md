# Handoff Frontend - Sprint B (Planning Confidence)

Data de referencia: 2026-06-05
Status do contrato: draft (aguardando liberacao da Sprint A)
Escopo: frontend

## Contexto da Sprint para Frontend

- Iniciativa macro: Insights operacionais por Resource Group.
- Objetivo desta sprint: habilitar confianca de planejamento e roadmap com qualidade de backlog.
- Modulo alvo (unico): Insights.
- Impacto esperado no frontend: alto.
- Migracao de telas: nova secao de Planning Confidence no grupo.
- Risco principal de integracao: interpretar proxies de backlog como historico preciso de fluxo.
- Acao esperada do frontend nesta sprint: implementar visualizacoes de confianca por epico e backlog quality.

## Dependencia obrigatoria

- Sprint B inicia somente se Sprint A estiver com status implementado-e-revisado.

## Envelope de resposta

- Sucesso: data preenchido, meta preenchido, error nulo.
- Erro: data nulo, meta preenchido, error com code, message e details opcional.

## Autenticacao e escopo

- Bearer JWT obrigatorio.
- Escopo de tenant no token.
- Nao enviar tenant_id.

## Permissoes da sprint

- insights.read

## Contratos da Sprint B

### 1) Planning Confidence por Resource Group

- Metodo e rota: GET /api/v1/insights/resource-groups/:group_id/planning-confidence
- Permissao: insights.read
- Path params:
  - group_id: uuid
- Query params:
  - period: string YYYY-MM ou YYYY-Qn, opcional (default current_month)

#### Resposta 200 (shape v1)

```json
{
  "data": {
    "resource_group": {
      "id": "uuid",
      "key": "payments-platform",
      "name": "Payments Platform"
    },
    "period": "2026-06",
    "planning_confidence": {
      "score": 68,
      "level": "watch",
      "trend": "down",
      "drivers": ["scope_drift", "backlog_staleness", "incident_pressure"]
    },
    "roadmap_confidence": {
      "score": 64,
      "trend": "down",
      "on_track_ratio": 0.42,
      "delayed_epics_count": 4
    },
    "epics": [
      {
        "epic_id": "uuid",
        "epic_name": "Checkout Revamp",
        "confidence_score": 52,
        "confidence_level": "low",
        "weeks_overdue": 2,
        "drivers": ["schedule_drift", "dependency_pressure"]
      }
    ],
    "incident_correlation": {
      "impacted_epics_count": 3,
      "roadmap_risk_due_to_incidents": "high"
    },
    "warnings": ["flow_regression_rate_uses_proxy"]
  },
  "meta": {
    "request_id": "req_010",
    "version": "v1",
    "timestamp": "2026-06-05T18:00:00.000Z"
  },
  "error": null
}
```

#### Status HTTP

- 200 sucesso
- 400 path/query invalido
- 401 nao autenticado
- 403 sem permissao
- 404 resource group nao encontrado

### 2) Backlog Quality por Resource Group

- Metodo e rota: GET /api/v1/insights/resource-groups/:group_id/backlog-quality
- Permissao: insights.read
- Path params:
  - group_id: uuid
- Query params:
  - stale_days: integer 7-120, opcional (default 21)

#### Resposta 200 (shape v1)

```json
{
  "data": {
    "resource_group": {
      "id": "uuid",
      "key": "payments-platform",
      "name": "Payments Platform"
    },
    "backlog_quality": {
      "score": 61,
      "level": "watch",
      "backlog_aging_index_days": 34,
      "stale_backlog_rate": 0.31,
      "overdue_backlog_rate": 0.18,
      "flow_regression_rate": 0.11,
      "backlog_churn_proxy": 0.27
    },
    "thresholds": {
      "stale_days": 21
    },
    "warnings": ["no_task_status_transition_history"]
  },
  "meta": {
    "request_id": "req_011",
    "version": "v1",
    "timestamp": "2026-06-05T18:00:00.000Z"
  },
  "error": null
}
```

#### Status HTTP

- 200 sucesso
- 400 path/query invalido
- 401 nao autenticado
- 403 sem permissao
- 404 resource group nao encontrado

## Regras de UX

- Mostrar claramente que flow_regression_rate e proxy quando warning vier preenchido.
- Exibir score + drivers lado a lado para facilitar tomada de decisao.
- Permitir drilldown por epico com estados de risco.
- Nao transformar valores nulos em zero.

## Checklist de implementacao frontend

1. Implementar secao planning_confidence no detalhe do grupo.
2. Implementar tabela/lista de epicos com confidence e drivers.
3. Implementar secao backlog_quality com indicadores e warning.
4. Implementar filtros de periodo.
5. Telemetria: interacao com drivers e drilldown por epico.

## Gate de revisao tecnica (obrigatorio no encerramento da sprint)

- revisado_contra_codigo: false
- commit_revisado: pendente
- openapi_revisado: pendente
- divergencias_encontradas: []
- status_final: draft

Para liberar Sprint C:

- revisado_contra_codigo: true
- status_final: implementado-e-revisado
