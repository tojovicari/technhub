-- Gatilhos configuráveis de DORA por time (.spec/spec-engineering-intelligence.md,
-- Seção 6: "Valor da Métrica = f(Evento Inicial, Evento Final, Filtro,
-- Agrupamento)"). Coluna nova, não uma chave dentro do `rules` JSONB
-- existente: `upsertTeamRules`/`upsertOrgRules` fazem replace completo da
-- coluna que gravam, então misturar gatilho e regra de classificação na
-- mesma coluna arriscaria uma tela sobrescrever silenciosamente o que a
-- outra gravou. Nullable, sem backfill — ausência em todo nível de
-- precedência (time/organização) já resolve pro fallback do sistema
-- (MetricTriggerConfigRepository.getEffectiveTriggerConfig).
ALTER TABLE team_metric_configurations ADD COLUMN metric_triggers JSONB;

-- `rules` era NOT NULL porque, até aqui, toda linha desta tabela só existia
-- pra guardar regras de classificação. Agora uma linha pode existir só pra
-- guardar `metric_triggers` (time que configurou gatilho de DORA sem nunca
-- ter mexido em regra de classificação) — inserir um `rules` inventado
-- (ex: `'{}'::jsonb`) só pra satisfazer NOT NULL quebraria
-- `evaluateWorkItemType`/`evaluateWorkflowState` (esperam arrays, não um
-- objeto vazio) na próxima rodada de enrichment desse time. As duas colunas
-- precisam ser independentes de verdade — cada uma NULL até que a tela
-- correspondente seja usada, cada leitura (`getEffectiveRules`/
-- `getEffectiveTriggerConfig`) já checa `IS NOT NULL` antes de tratar como
-- "configurado neste nível".
ALTER TABLE team_metric_configurations ALTER COLUMN rules DROP NOT NULL;
