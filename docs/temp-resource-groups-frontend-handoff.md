# Temp - Handoff Frontend (Sprint 4 - DORA por Resource Group)

Data de referencia: 2026-06-03
Escopo: somente Sprint 4 (DORA)
Status: draft para frontend + backend ainda sem endpoint dedicado por group_id

## Contexto da sprint

- Iniciativa macro: Replanejamento Recursos + Resource Groups.
- Objetivo da Sprint 4: migrar leitura executiva de DORA para escopo de Resource Group.
- Impacto no frontend: medio (novos filtros, novos adapters e estados de indisponibilidade controlada).

## Leitura importante antes de implementar

Hoje nao existe rota dedicada `GET /api/v1/dora/resource-groups/:group_id/scorecard` no backend.

Rotas DORA disponiveis hoje:

- `GET /api/v1/dora/scorecard`
- `GET /api/v1/dora/deploys`
- `GET /api/v1/dora/history/:metric_name`
- `POST /api/v1/dora/deploys`
- `POST /api/v1/dora/lead-time`

Conclusao pratica para frontend:

- Preparar UI e adapters para DORA por Resource Group nesta sprint.
- Integracao final de dados agregados por grupo depende da entrega do endpoint dedicado no backend.

## Envelope de resposta

- Sucesso: `data` preenchido, `meta` preenchido, `error` nulo.
- Erro: `data` nulo, `meta` preenchido, `error` com `code`, `message` e `details` opcional.

## Autenticacao e escopo

- Todas as rotas exigem JWT (`Authorization: Bearer <token>`).
- Tenant e derivado do token (`tenant_id`).
- Frontend nao envia `tenant_id` no body/query dessas rotas.

## Contratos Sprint 4

### 1. Contrato alvo (draft) - DORA por Resource Group

- Metodo e rota (alvo): `GET /api/v1/dora/resource-groups/:group_id/scorecard`
- Permissao alvo: `dora.read`
- Path params:
  - `group_id`: uuid (obrigatorio)
- Query params:
  - `window_days`: inteiro 1..365, opcional (default 30)
  - `environment`: string, opcional (default `production`)
- Status esperado:
  - `200` sucesso
  - `400` query/param invalido
  - `401` nao autenticado
  - `403` sem permissao
  - `404` grupo nao encontrado

Payload alvo de `data`:

- `resource_group`: `{ id, key, name, project_count }`
- `window_days`, `window_start`, `window_end`
- `overall_level`
- `deployment_frequency`
- `lead_time`
- `mttr`
- `mtta`
- `incident_frequency`
- `change_failure_rate`

### 2. Contrato atual (disponivel) - DORA geral/projeto

- Metodo e rota: `GET /api/v1/dora/scorecard`
- Permissao: `dora.read`
- Query params:
  - `project_id`: uuid (opcional)
  - `window_days`: inteiro 1..365, opcional (default 30)
  - `environment`: string, opcional (default `production`)
- Sucesso: `200`
- Erros principais: `400`, `401`, `403`

Uso recomendado nesta transicao:

- Em tela de Resource Group, nao fingir agregacao por grupo via frontend.
- Exibir estado "Aguardando consolidacao DORA por Resource Group" quando endpoint alvo nao estiver liberado.

## Exemplo pronto para frontend (contrato alvo draft)

### Request

```http
GET /api/v1/dora/resource-groups/b2b2a93a-4156-4e60-9e5f-08f7b4f59dc0/scorecard?window_days=30&environment=production HTTP/1.1
Authorization: Bearer <JWT>
```

### Response 200 (formato esperado)

```json
{
  "data": {
    "resource_group": {
      "id": "b2b2a93a-4156-4e60-9e5f-08f7b4f59dc0",
      "key": "payments-platform",
      "name": "Payments Platform",
      "project_count": 3
    },
    "window_days": 30,
    "window_start": "2026-05-01T00:00:00.000Z",
    "window_end": "2026-05-31T23:59:59.000Z",
    "overall_level": "high",
    "deployment_frequency": {
      "value": 1.2,
      "unit": "per_day",
      "level": "elite",
      "deploy_count": 36
    },
    "lead_time": {
      "p50": 7.8,
      "p95": 21.4,
      "unit": "hours",
      "level": "high",
      "sample_size": 31
    },
    "mttr": {
      "value": 2.9,
      "unit": "hours",
      "level": "high",
      "sample_size": 4
    },
    "mtta": {
      "p50": 0.22,
      "unit": "hours",
      "level": "elite",
      "sample_size": 8
    },
    "incident_frequency": {
      "value": 0.2,
      "unit": "per_day"
    },
    "change_failure_rate": {
      "value": 5.5,
      "unit": "percent",
      "level": "high",
      "total_deploys": 36,
      "failed_deploys": 2
    }
  },
  "meta": {
    "request_id": "req_dora_rg_001",
    "version": "v1",
    "timestamp": "2026-06-03T14:00:00.000Z"
  },
  "error": null
}
```

## Regras de UX para frontend (Sprint 4)

- Dashboard de DORA no contexto de grupo deve deixar explicito quando estiver em modo "draft/aguardando backend".
- Nao fazer agregacao client-side somando scorecards de projetos sem alinhamento formal (evita inconsistencias de formula).
- Tratar `404` como grupo inexistente (ou fora do tenant).
- Exibir metricas nulas como "Sem dados suficientes" e nao como zero.

## Checklist de implementacao frontend (Sprint 4)

- Preparar tipagens para payload alvo de DORA por Resource Group.
- Preparar adapter de consumo para rota alvo (feature-flag).
- Implementar estado de fallback controlado enquanto rota alvo nao estiver disponivel.
- Manter tela atual de DORA geral/projeto funcional sem regressao.
- Incluir telemetria de UX para uso de filtro por Resource Group e janela temporal.

## Referencias de contrato

- Documento frontend DORA: `docs/frontend/dora-api.md`
- OpenAPI DORA: `docs/openapi/dora-v1.yaml`
- Plano macro: `docs/resource-group-replan.md`
