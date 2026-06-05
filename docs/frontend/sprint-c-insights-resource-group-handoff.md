# Handoff Frontend - Sprint C (Trends e Operacao)

Data de referencia: 2026-06-05
Status do contrato: implementado-e-revisado
Escopo: frontend

## Contexto da Sprint para Frontend

- Iniciativa macro: Insights operacionais por Resource Group.
- Objetivo desta sprint: habilitar tendencias, anomalias e operacao de recompute.
- Modulo alvo (unico): Insights.
- Impacto esperado no frontend: medio.
- Migracao de telas: expandir painel com series temporais e controle operacional.
- Risco principal de integracao: tratar recompute como sync imediato sem polling de status.
- Acao esperada do frontend nesta sprint: implementar visao de trends e fluxo de recompute seguro.

## Dependencia obrigatoria

- Sprint C inicia somente se Sprint B estiver com status implementado-e-revisado.

## Envelope de resposta

- Sucesso: data preenchido, meta preenchido, error nulo.
- Erro: data nulo, meta preenchido, error com code, message e details opcional.

## Autenticacao e escopo

- Bearer JWT obrigatorio.
- Escopo de tenant no token.
- Nao enviar tenant_id.

## Permissoes da sprint

- insights.read
- insights.recompute

## Contratos da Sprint C

### 1) Trends por Resource Group

- Metodo e rota: GET /api/v1/insights/resource-groups/:group_id/trends
- Permissao: insights.read
- Path params:
  - group_id: uuid
- Query params:
  - window_days: integer 14-180, opcional (default 60)

#### Resposta 200 (shape v1)

```json
{
  "data": {
    "resource_group": {
      "id": "uuid",
      "key": "payments-platform",
      "name": "Payments Platform"
    },
    "window_days": 60,
    "series": {
      "throughput": [{ "date": "2026-05-01", "value": 12 }],
      "incidents": [{ "date": "2026-05-01", "value": 2 }],
      "confidence": [{ "date": "2026-05-01", "value": 71 }]
    },
    "anomalies": [
      {
        "metric_name": "throughput",
        "date": "2026-05-22",
        "z_score": -2.8,
        "direction": "drop"
      }
    ],
    "degradation_signals": [
      {
        "id": "throughput_decline_4w",
        "level": "high",
        "message": "Queda consistente de throughput nas ultimas 4 semanas"
      }
    ],
    "warnings": []
  },
  "meta": {
    "request_id": "req_020",
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

### 2) Recompute de Insights

- Metodo e rota: POST /api/v1/insights/resource-groups/:group_id/recompute
- Permissao: insights.recompute
- Path params:
  - group_id: uuid
- Body:

```json
{
  "mode": "full",
  "reason": "manual_refresh"
}
```

- Campos:
  - mode: full | incremental (default incremental)
  - reason: string opcional

#### Resposta 202 (shape v1)

```json
{
  "data": {
    "job_id": "uuid",
    "status": "queued",
    "resource_group_id": "uuid",
    "submitted_at": "2026-06-05T18:00:00.000Z"
  },
  "meta": {
    "request_id": "req_021",
    "version": "v1",
    "timestamp": "2026-06-05T18:00:00.000Z"
  },
  "error": null
}
```

#### Status HTTP

- 202 aceito para processamento
- 400 path/body invalido
- 401 nao autenticado
- 403 sem permissao
- 404 resource group nao encontrado
- 409 job ja em execucao para o grupo

## Regras de UX

- Recompute deve mostrar status assicrono (queued/running/success/failed).
- Nao bloquear a tela aguardando retorno final sincrono.
- Exibir ultimo generated_at do snapshot para transparencia de freshness.
- Exibir mensagens de degradacao e anomalias em destaque operacional.

## Checklist de implementacao frontend

1. Implementar graficos de series temporais do endpoint trends.
2. Implementar cards/lista de anomalias e degradacao.
3. Implementar acao de recompute com controle de estado.
4. Implementar feedback de conflito (409) e retry guidado.
5. Telemetria: trigger de recompute e consumo de anomalias.

## Gate de revisao tecnica (obrigatorio no encerramento da sprint)

- revisado_contra_codigo: true
- commit_revisado: b6e1e54
- openapi_revisado: docs/openapi/insights-v1.yaml@1.0.0
- divergencias_encontradas: []
- status_final: implementado-e-revisado

Para fechamento do ciclo de Insights:

- revisado_contra_codigo: true
- status_final: implementado-e-revisado
