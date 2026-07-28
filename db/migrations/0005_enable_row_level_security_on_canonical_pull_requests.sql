-- Traz canonical_pull_requests para o padrão de segregação de acessos formalizado em
-- .spec/spec-engineering-intelligence.md, Seção 4.3: RLS habilitada e forçada, mesmo para
-- o owner da tabela (a role de aplicação hoje é a mesma que criou a tabela em dev local).
ALTER TABLE canonical_pull_requests
    ADD CONSTRAINT fk_canonical_pull_requests_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE canonical_pull_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_pull_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON canonical_pull_requests
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
