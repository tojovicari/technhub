-- Liga uma integração a um time da plataforma (ex: "o Jira do Squad Checkout").
-- Necessário pra Enriched Layer saber a qual team_id atribuir os
-- canonical_work_items daquele provider — hoje a única fonte de team
-- disponível de verdade (assignee_external_id costuma vir nulo dos
-- conectores atuais, ver .spec/spec-engineering-intelligence.md Seção 3/5).
ALTER TABLE provider_integrations
    ADD COLUMN team_id UUID REFERENCES teams(id);
