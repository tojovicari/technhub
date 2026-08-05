-- PersonProfileService (GET /tenants/:tenantId/users/:userId/profile) casa a
-- pessoa contra as 4 fontes canônicas via JOIN unnest(aliases) ON provider +
-- external_id, sem filtro prévio por team_id (diferente de TeamProfileService,
-- que já filtra por team_id indexado antes de casar identidade). Sem índice
-- dedicado, cada chamada fazia Seq Scan na tabela inteira do tenant — medido
-- em dado real (tenant c94be6fb, ~9k work items / ~11k PRs): 5.2ms via Seq
-- Scan + Hash Join vs 0.3ms via Index Scan dirigido pelos aliases da pessoa
-- (tipicamente 2-5 linhas), e o ganho cresce com o tamanho do tenant — Seq
-- Scan escala com o total de linhas da tabela, Index Scan escala com o
-- número de aliases da pessoa.
CREATE INDEX idx_canonical_work_items_tenant_provider_assignee
  ON canonical_work_items (tenant_id, provider, assignee_external_id);

CREATE INDEX idx_canonical_pull_requests_tenant_provider_author
  ON canonical_pull_requests (tenant_id, provider, author_external_id);

CREATE INDEX idx_canonical_deployments_tenant_provider_triggered_by
  ON canonical_deployments (tenant_id, provider, triggered_by_external_id);

CREATE INDEX idx_canonical_incidents_tenant_provider_assignee
  ON canonical_incidents (tenant_id, provider, assignee_external_id);
