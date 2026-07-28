-- Corrige gap de isolamento multi-tenant na Camada Canônica de Pull Requests.
--
-- A unicidade original (provider, external_id) assume que o external_id de
-- um provedor é globalmente único. Isso vale para providers hospedados
-- (github.com), mas não para self-hosted (GitLab CE, ArgoCD): duas
-- instâncias de tenants diferentes podem ter, por coincidência, o mesmo
-- número de PR no mesmo nome de repositório, e colidiriam entre si.
-- Também corrige um caso já possível com um único tenant: dois repositórios
-- distintos podem ter PR de mesmo número (ex: PR #1 em dois repos).
ALTER TABLE canonical_pull_requests
    ADD COLUMN tenant_id UUID NOT NULL;

ALTER TABLE canonical_pull_requests
    DROP CONSTRAINT unique_provider_pull_request;

ALTER TABLE canonical_pull_requests
    ADD CONSTRAINT unique_tenant_provider_repository_pull_request
        UNIQUE (tenant_id, provider, repository, external_id);

CREATE INDEX idx_canonical_pull_requests_tenant_id ON canonical_pull_requests (tenant_id);
