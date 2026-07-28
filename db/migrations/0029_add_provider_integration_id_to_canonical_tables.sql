-- Suporte a múltiplas integrações por provider (Jira/Linear/GitHub Actions):
-- canonical_work_items/canonical_deployments passam a registrar QUAL
-- integração originou cada registro, não só o nome do provider. Necessário
-- pra Enriched Layer atribuir team_id corretamente quando dois tenants do
-- mesmo provider (ex: dois boards Jira) coexistirem — ver
-- 0030_drop_unique_tenant_provider_on_provider_integrations.sql, que remove
-- a restrição de "uma integração por provider" que motivou esta mudança.

ALTER TABLE canonical_work_items
    ADD COLUMN provider_integration_id UUID REFERENCES provider_integrations(id);

ALTER TABLE canonical_deployments
    ADD COLUMN provider_integration_id UUID REFERENCES provider_integrations(id);

-- Backfill: até este momento cada (tenant_id, provider) tem no máximo uma
-- integração, então o match é sempre não-ambíguo. FORCE ROW LEVEL SECURITY
-- vale mesmo pra migrations (a role da app não tem BYPASSRLS) — desliga
-- temporariamente pra esse UPDATE cross-tenant, religa antes do fim da
-- transação.
ALTER TABLE provider_integrations DISABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_work_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_deployments DISABLE ROW LEVEL SECURITY;

UPDATE canonical_work_items cwi
SET provider_integration_id = pi.id
FROM provider_integrations pi
WHERE pi.tenant_id = cwi.tenant_id
  AND pi.provider = cwi.provider;

UPDATE canonical_deployments cd
SET provider_integration_id = pi.id
FROM provider_integrations pi
WHERE pi.tenant_id = cd.tenant_id
  AND pi.provider = cd.provider;

ALTER TABLE provider_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_integrations FORCE ROW LEVEL SECURITY;
ALTER TABLE canonical_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_work_items FORCE ROW LEVEL SECURITY;
ALTER TABLE canonical_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_deployments FORCE ROW LEVEL SECURITY;

ALTER TABLE canonical_work_items
    ALTER COLUMN provider_integration_id SET NOT NULL;

ALTER TABLE canonical_deployments
    ALTER COLUMN provider_integration_id SET NOT NULL;

ALTER TABLE canonical_work_items
    DROP CONSTRAINT unique_tenant_provider_item;

ALTER TABLE canonical_work_items
    ADD CONSTRAINT unique_tenant_integration_item
        UNIQUE (tenant_id, provider_integration_id, external_id);

ALTER TABLE canonical_deployments
    DROP CONSTRAINT unique_tenant_provider_deployment;

ALTER TABLE canonical_deployments
    ADD CONSTRAINT unique_tenant_integration_deployment
        UNIQUE (tenant_id, provider_integration_id, external_id);

CREATE INDEX idx_canonical_work_items_provider_integration_id
    ON canonical_work_items (provider_integration_id);

CREATE INDEX idx_canonical_deployments_provider_integration_id
    ON canonical_deployments (provider_integration_id);
