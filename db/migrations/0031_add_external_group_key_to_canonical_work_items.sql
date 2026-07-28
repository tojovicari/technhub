-- Suporte a vínculo pós-sync de board/time do Jira/Linear (mesmo padrão já
-- usado por GitHub/PRs via team_resource_links(github_repository) e
-- Waroom/incidentes via team_resource_links(waroom_team)): cada work item
-- passa a carregar o "grupo de origem" (projeto no Jira, time no Linear),
-- pra permitir sincronizar o site/workspace inteiro e vincular board→time
-- depois, sem exigir uma integração por board.
ALTER TABLE canonical_work_items
    ADD COLUMN external_group_key VARCHAR(100);

CREATE INDEX idx_canonical_work_items_external_group_key
    ON canonical_work_items (external_group_key);

-- Backfill best-effort pro dado já sincronizado: Jira e Linear usam o mesmo
-- formato de identificador "PREFIXO-NUMERO" (chave do projeto/time é o
-- prefixo). É só conveniência pra não exigir re-sync imediato — a próxima
-- sincronização real sempre sobrescreve com o valor vindo da API.
--
-- FORCE ROW LEVEL SECURITY vale mesmo pra migrations (a role da app não tem
-- BYPASSRLS) — desliga temporariamente pra esse UPDATE cross-tenant, religa
-- antes do fim da transação (mesmo padrão já usado na migration 0029).
ALTER TABLE canonical_work_items DISABLE ROW LEVEL SECURITY;

UPDATE canonical_work_items
SET external_group_key = substring(external_id from '^([A-Za-z0-9]+)-')
WHERE provider IN ('jira', 'linear')
  AND external_group_key IS NULL;

ALTER TABLE canonical_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_work_items FORCE ROW LEVEL SECURITY;
