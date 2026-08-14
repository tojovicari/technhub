-- Resultado da resolução de épico (src/enrichment/epic-resolver.ts) — ver
-- EnrichedWorkItem.epicExternalId/epicExternalName/isEpicContainer em
-- domain-context.types.ts. epic_external_id/name nulos = sem épico
-- resolvido (não é erro); is_epic_container = true exclui o item da
-- quebra por completo (é o próprio container, não conta a si mesmo).
ALTER TABLE enriched_work_items
    ADD COLUMN epic_external_id VARCHAR(255),
    ADD COLUMN epic_external_name VARCHAR(255),
    ADD COLUMN is_epic_container BOOLEAN NOT NULL DEFAULT false;
