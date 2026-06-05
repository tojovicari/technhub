# Handoff Frontend - Sprint A (Insights por Resource Group)

Data de referencia: 2026-06-05
Status do contrato: draft (pre-implementacao)
Escopo: frontend

## Contexto da Sprint para Frontend

- Iniciativa macro: Insights operacionais por Resource Group.
- Objetivo desta sprint: entregar a base do painel de overview com incidentes e sinais iniciais de execucao.
- Modulo alvo (unico): Insights.
- Impacto esperado no frontend: medio.
- Migracao de telas: nova secao no detalhe de Resource Group.
- Risco principal de integracao: frontend assumir campos nao garantidos antes da revisao do contrato implementado.
- Acao esperada do frontend nesta sprint: implementar painel de overview e incidente com estado de erro/permissao.

## Regras de Liberacao entre Sprints

- Sprint B so pode iniciar apos este documento estar em status implementado-e-revisado.
- Criterio de liberacao obrigatorio:
  - revisado_contra_codigo: true
  - commit_revisado: <hash>
  - openapi_revisado: <arquivo/versao>

## Envelope de resposta

- Sucesso: data preenchido, meta preenchido, error nulo.
- Erro: data nulo, meta preenchido, error com code, message e details opcional.
- Campos de meta esperados: request_id, version, timestamp.

## Autenticacao e escopo

- Todas as rotas exigem autenticacao por Bearer JWT.
- Escopo de tenant aplicado pelo token do usuario.
- Frontend nao envia tenant_id em body/query.

## Permissoes da sprint

- insights.read

## Contratos da Sprint A

### 1) Overview por Resource Group

- Metodo e rota: GET /api/v1/insights/resource-groups/:group_id/overview
- Permissao: insights.read
- Path params:
  - group_id: uuid
- Query params:
  - window_days: integer 7-180, opcional (default 30)

#### Resposta 200 (shape v1)

```json
{
  "data": {
    "resource_group": {
      "id": "uuid",
      "key": "payments-platform",
      "name": "Payments Platform"
    },
    "period": {
      "window_days": 30,
      "from": "2026-05-06T00:00:00.000Z",
      "to": "2026-06-05T23:59:59.999Z"
    },
    "health_score": 74,
    "risk_level": "watch",
    "drivers": ["incident_load", "throughput_drop", "backlog_staleness"],
    "execution": {
      "throughput_7d": 42,
      "throughput_30d": 160,
      "trend": "down"
    },
    "incident": {
      "incident_count_7d": 6,
      "incident_count_30d": 18,
      "mtta_p50_minutes": 18,
      "mttr_p50_hours": 3.4,
      "mttr_source": "incidents"
    },
    "recommendations": [
      {
        "type": "reduce_wip",
        "priority": "high",
        "message": "Reduzir WIP do grupo em 15% para estabilizar throughput",
        "context": { "current_wip": 48 }
      }
    ],
    "warnings": []
  },
  "meta": {
    "request_id": "req_001",
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

### 2) Incident Insights por Resource Group

- Metodo e rota: GET /api/v1/insights/resource-groups/:group_id/incidents
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
    "total_incidents": 18,
    "severity_distribution": [
      { "severity": "P1", "count": 4 },
      { "severity": "P2", "count": 8 },
      { "severity": "P3", "count": 6 }
    ],
    "hotspot_services": [
      { "service": "checkout-api", "count": 9 },
      { "service": "billing-worker", "count": 5 }
    ],
    "mtta_p50_minutes": 18,
    "mttr_p50_hours": 3.4,
    "warnings": []
  },
  "meta": {
    "request_id": "req_002",
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

- Exibir estado sem permissao para 403.
- Nao mascarar erro de permissao como lista vazia.
- Exibir warnings retornados pela API quando houver falta de dados.
- Campos nulos de MTTR/MTTA devem ser exibidos como dado indisponivel.

## Checklist de implementacao frontend

1. Criar camada de client para /overview e /incidents.
2. Implementar cards de health_score, risk_level e drivers.
3. Implementar secao de incidentes com distribuicao e hotspots.
4. Implementar estados loading, empty, error e forbidden.
5. Instrumentar telemetria basica: abertura do painel e troca de filtro.

## Gate de revisao tecnica (obrigatorio no encerramento da sprint)

Preencher ao final da implementacao backend:

- revisado_contra_codigo: false
- commit_revisado: pendente
- openapi_revisado: pendente
- divergencias_encontradas: []
- status_final: draft

Quando finalizar revisao:

- revisado_contra_codigo: true
- status_final: implementado-e-revisado
