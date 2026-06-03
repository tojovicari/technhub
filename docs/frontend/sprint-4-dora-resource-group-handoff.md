# Handoff Frontend - Sprint 4 (DORA por Resource Group)

Data de referência: 2026-06-03
Status do contrato: implementado no backend
Escopo: frontend

## Contexto da Sprint para Frontend

- Iniciativa macro: Replanejamento Recursos + Resource Group.
- Objetivo desta sprint: habilitar leitura de DORA consolidado por Resource Group com scorecard no escopo do grupo.
- Módulo alvo (único): DORA.
- Impacto esperado no frontend: médio.
- Migração de telas: nova UX de DORA no contexto de Resource Group.
- Risco principal de integração: continuar exibindo scorecard por projeto técnico em telas executivas de grupo.
- Ação esperada do frontend nesta sprint: adaptar consultas, cards e filtros para scorecard por Resource Group.

## Envelope de resposta

- Sucesso: data preenchido, meta preenchido, error nulo.
- Erro: data nulo, meta preenchido, error com code, message e details opcional.
- Campos de meta esperados: request_id, version, timestamp.

## Autenticação e escopo

- Todas as rotas exigem autenticação por Bearer JWT.
- Escopo de tenant é aplicado a partir do token do usuário autenticado.
- Frontend não deve enviar tenant_id em body/query para este módulo.

## Contratos e permissões (Sprint 4)

### 1) Scorecard DORA por Resource Group

- Método e rota: GET /api/v1/dora/resource-groups/:group_id/scorecard
- Permissão: dora.read
- Path params:
  - group_id: uuid
- Query params:
  - window_days: inteiro 1-365, opcional (default 30)
  - environment: string, opcional (default production)
- Resposta de sucesso: 200
- Erros principais:
  - 400 param/query inválido
  - 401 não autenticado
  - 403 sem permissão
  - 404 grupo não encontrado

Formato de data no sucesso:

- resource_group: id, key, name, project_count
- window_days, window_start, window_end
- overall_level
- deployment_frequency
- lead_time
- mttr
- mtta
- incident_frequency
- change_failure_rate

### 2) Scorecard DORA geral (compatível)

- Método e rota: GET /api/v1/dora/scorecard
- Permissão: dora.read
- Query params:
  - project_id: uuid, opcional
  - window_days: inteiro 1-365, opcional (default 30)
  - environment: string, opcional (default production)
- Resposta de sucesso: 200
- Erros principais: 400, 401, 403

## Exemplo de request (rota de grupo)

GET /api/v1/dora/resource-groups/b2b2a93a-4156-4e60-9e5f-08f7b4f59dc0/scorecard?window_days=30&environment=production

## Exemplo de response 200

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
    "project_id": null,
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

## Regras de UX

- Sempre exibir estado sem permissão para 403.
- Não mascarar erro de permissão como lista vazia.
- Exibir métricas nulas como sem dados suficientes, nunca como zero.
- Exibir sempre o período do scorecard (window_start e window_end).

## Mapeamento de permissões por papel padrão

- manager: dora.read
- viewer: dora.read
- org_admin: acesso total

## Checklist de implementação frontend

1. Integrar GET /dora/resource-groups/:group_id/scorecard na tela executiva de Resource Group.
2. Atualizar cards para DF, LT, MTTR e CFR com leitura no escopo de grupo.
3. Adicionar filtros de window_days e environment no contexto do grupo.
4. Implementar estados de loading, vazio e indisponível para scorecard por grupo.
5. Atualizar tipagens e adapters para payload de group scorecard.
6. Adicionar telemetria de UX para uso de filtros e navegação do painel DORA por grupo.

## Critérios de aceite (Sprint 4)

- Painéis de DORA exibem scorecard por Resource Group sem dependência de visão por projeto isolado.
- Níveis e métricas de DORA aparecem com consistência em cards e detalhes.
- Filtros por grupo, janela e ambiente funcionam sem quebra de navegação.
- Fallback de dados insuficientes é exibido de forma explícita para o usuário.

## Referências

- [docs/resource-group-replan.md](docs/resource-group-replan.md)
- [docs/frontend/dora-api.md](docs/frontend/dora-api.md)
- [docs/openapi/dora-v1.yaml](docs/openapi/dora-v1.yaml)
