-- Cache do id do custom field de Epic Link (Jira, projetos company-managed
-- clássicos, sem id fixo — varia por site). Duas colunas, não uma: um
-- TEXT nullable sozinho não distingue "nunca tentei descobrir" de "já
-- tentei, o site não tem esse campo" — os dois virariam NULL. O boolean
-- resolve isso: `epic_link_field_resolved = false` = nunca tentou (Jira
-- provider descobre no próximo sync); `true` = já descobriu, usa
-- `epic_link_field_id` como está (inclusive null, se o site for
-- team-managed puro) sem tentar de novo.
ALTER TABLE provider_integrations
    ADD COLUMN epic_link_field_id VARCHAR(50),
    ADD COLUMN epic_link_field_resolved BOOLEAN NOT NULL DEFAULT false;
