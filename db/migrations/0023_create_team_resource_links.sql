-- Vínculo manual de recurso externo (time do Waroom, repositório do GitHub)
-- a um time da plataforma — mesmo espírito de `user_provider_aliases`, mas
-- pra recurso em vez de pessoa. Generalizado (`resource_type` distingue o
-- caso de uso) em vez de duas tabelas quase-duplicadas, mesmo padrão de
-- `provider`/`category` já usado em `provider_integrations`.
--
-- Alimenta a resolução de time por incidente (Waroom não segue o modelo
-- "1 integração = 1 time") e o filtro por time de Lead Time (PRs do GitHub,
-- sincronizados por organização inteira, não por repositório).
CREATE TABLE team_resource_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,                -- 'waroom' | 'github'
    resource_type VARCHAR(50) NOT NULL,           -- 'waroom_team' | 'github_repository'
    external_resource_id VARCHAR(255) NOT NULL,   -- external_team_id do Waroom, ou "owner/repo" do GitHub
    external_resource_name VARCHAR(255),          -- só pra exibição

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_tenant_provider_resource UNIQUE (tenant_id, provider, resource_type, external_resource_id)
);

CREATE INDEX idx_team_resource_links_team_id ON team_resource_links (team_id);

ALTER TABLE team_resource_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_resource_links FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON team_resource_links
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
