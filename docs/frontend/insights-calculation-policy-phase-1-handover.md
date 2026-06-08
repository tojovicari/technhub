# Handover Frontend - Insights Calculation Policy - Fase 1

Data de referencia: 2026-06-08
Status do handover: pronto para validacao
Escopo: frontend

## Resumo executivo

A Fase 1 implementou apenas base de persistencia e resolucao de policy no backend.

Nao houve mudanca de contrato HTTP consumido pelo frontend nesta fase.

## Objetivo da fase entregue

1. Introduzir estrutura de dados para policy de calculo por Resource Group.
2. Garantir resolucao de policy ativa com precedencia definida.
3. Preparar versionamento para proximas fases sem breaking change.

## Mudancas tecnicas implementadas

1. Nova entidade de persistencia: ResourceGroupCalculationPolicy.
2. Novo enum de status de policy: draft, active, archived.
3. Service backend para resolver policy ativa por precedencia:
   1. resource_group
   2. tenant_default
   3. legacy fallback
4. Service backend para calcular proxima versao da policy por escopo.

## Contratos de API (impacto frontend)

Impacto desta fase:

1. Nenhum endpoint novo exposto.
2. Nenhum endpoint existente alterado.
3. Nenhuma permissao nova exigida no frontend nesta fase.
4. Nenhuma mudanca de payload de resposta para telas atuais.

Conclusao para frontend:

1. Nao ha implementacao obrigatoria de UI nesta fase.
2. Pode manter integracao atual sem alteracoes.

## Permissoes

Novas permissoes para policy ainda nao entram em uso nesta fase.

Permissoes atuais de Insights permanecem inalteradas:

1. insights.read
2. insights.recompute

## Casos de uso cobertos nesta fase (backend interno)

1. Resolver policy ativa do resource group para uma data de referencia.
2. Usar policy default do tenant quando nao houver policy ativa do grupo.
3. Aplicar fallback legado quando nao houver policy ativa aplicavel.
4. Calcular proximo numero de versao para policy no escopo.

## Evidencias de validacao

1. Build TypeScript da API executado com sucesso.
2. Testes unitarios do service de policy: 6/6 passando.
3. Testes existentes das rotas de Insights: 24/24 passando.

## Mudancas de dados

Schema/migracao adicionados:

1. Enum ResourceGroupCalculationPolicyStatus.
2. Tabela ResourceGroupCalculationPolicy.
3. Indices de busca por tenant, escopo e janela de efetividade.
4. Foreign keys para Tenant e ResourceGroup.

## Riscos e observacoes para o frontend

1. Sem risco funcional imediato, pois nao ha mudanca de contrato HTTP.
2. Fases seguintes vao introduzir endpoints e payloads de policy; frontend deve esperar proximo handover antes de implementar.

## Checklist de aceite frontend da fase

1. Confirmar que nao houve quebra em telas atuais de Insights.
2. Executar smoke test dos fluxos existentes de overview, incidents, planning, backlog, trends e recompute.
3. Confirmar alinhamento para receber contratos da Fase 2 em handover dedicado.

## Gate de encerramento da fase

- revisado_contra_codigo: true
- mudanca_de_contrato_frontend: false
- acao_frontend_obrigatoria: nenhuma
- status_final_fase_1: aguardando aprovacao
