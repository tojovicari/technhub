-- Work items agora podem ser enriquecidos antes de o board/time de origem
-- (external_group_key) ser vinculado a um time da plataforma — mesmo
-- espírito de enriched_incidents.team_id, que já é nullable pelo mesmo
-- motivo (0021_create_enriched_incidents.sql).
ALTER TABLE enriched_work_items
    ALTER COLUMN team_id DROP NOT NULL;
