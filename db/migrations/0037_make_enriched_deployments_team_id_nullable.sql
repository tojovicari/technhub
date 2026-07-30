-- Deployments do ArgoCD agora podem ser enriquecidos antes de o projeto de
-- origem (external_group_key) ser vinculado a um time da plataforma —
-- mesmo espírito de enriched_work_items.team_id (0032) e
-- enriched_incidents.team_id (nullable desde a criação, 0021). GitHub
-- Actions continua sempre populando team_id (via provider_integrations.team_id),
-- essa coluna só passa a aceitar NULL de fato pro caso novo do ArgoCD.
ALTER TABLE enriched_deployments
    ALTER COLUMN team_id DROP NOT NULL;
