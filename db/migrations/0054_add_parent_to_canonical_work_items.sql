-- Referência de 1 salto ao "pai/container" do work item (épico, feature,
-- project), traduzida do jeito nativo de cada provider — ver
-- CanonicalWorkItem.parentExternalId em canonical.types.ts. Nullable, sem
-- backfill (mesmo padrão de quando external_group_key/name foram
-- adicionados): dado sincronizado antes desta migration só ganha o campo
-- na próxima sync incremental que tocar aquele item de novo.
ALTER TABLE canonical_work_items
    ADD COLUMN parent_external_id VARCHAR(255),
    ADD COLUMN parent_external_name VARCHAR(255);
