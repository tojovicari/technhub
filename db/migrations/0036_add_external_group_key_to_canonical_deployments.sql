-- Suporte a vínculo pós-sync de projeto/time do ArgoCD (mesmo padrão já
-- usado por Jira/Linear via team_resource_links(jira_project/linear_team)):
-- cada deployment passa a carregar o "grupo de origem" (projeto do ArgoCD,
-- spec.project da Application), pra permitir sincronizar o servidor
-- ArgoCD inteiro (várias Applications de vários times) e vincular
-- projeto→time depois, sem exigir uma integração por time.
--
-- Sempre NULL pro GitHub Actions, que continua no modelo simples de sempre
-- (1 integração = 1 repo = 1 time, via provider_integrations.team_id).
ALTER TABLE canonical_deployments
    ADD COLUMN external_group_key VARCHAR(100);

CREATE INDEX idx_canonical_deployments_external_group_key
    ON canonical_deployments (external_group_key);
