-- Remove o limite de "uma integração por provider" (spec, Seção 4.2: "No
-- MVP, cada tenant tem no máximo uma integração ativa por provider (...)
-- fica para uma versão futura") — esta é essa versão futura. A partir de
-- agora um tenant pode ter, por exemplo, duas integrações Jira (uma por
-- board/projeto, cada uma com seu próprio team_id).
ALTER TABLE provider_integrations
    DROP CONSTRAINT unique_tenant_provider;

CREATE INDEX idx_provider_integrations_tenant_provider
    ON provider_integrations (tenant_id, provider);
