-- Nome de exibição do "grupo de origem" (nome do projeto no Jira, nome do
-- time no Linear) — companheiro de external_group_key (migration 0031).
-- Mesmo padrão já usado por canonical_incidents.external_team_name
-- (Waroom): alimenta GET .../team-resource-links/candidates com nome
-- legível, não só a chave crua, na tela de vínculo externo → time.
--
-- Nullable de propósito: providers sem esse dado (nenhum hoje, mas a coluna
-- não deve travar caso surja um) devolvem null, mesmo tratamento que
-- external_team_name já tem pro Waroom.
ALTER TABLE canonical_work_items
    ADD COLUMN external_group_name VARCHAR(255);
