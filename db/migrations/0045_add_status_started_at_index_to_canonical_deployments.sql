-- Lead Time com `endEvent: 'CICD_DEPLOY'` (Seção 6 da spec) correlaciona
-- cada PR mergeado com o deploy de produção bem-sucedido mais próximo
-- depois do merge (`queryLeadTimeToDeployment`, JOIN LATERAL ordenado por
-- started_at, LIMIT 1) — sem este índice, o Postgres só conseguia usar
-- `idx_canonical_deployments_started_at` (started_at sozinho) pra entrar na
-- varredura, e filtrava `status = 'SUCCESS'` depois de já ter lido a linha
-- (Bitmap Heap Scan + Filter). Medido em dado real (tenant c94be6fb, ~2500
-- PRs mergeados correlacionados): 91ms via esse plano vs 5.7ms com este
-- índice compondo `status` e `started_at`, que deixa o Postgres pular
-- direto pro primeiro deploy `SUCCESS` depois do merge sem escanear os
-- `FAILURE`/`IN_PROGRESS`/`CANCELLED` no meio do caminho — 16x mais rápido,
-- e o ganho cresce com o volume de deploys do tenant. Beneficia de quebra
-- `queryChangeFailureRate`/`queryDeploymentFrequency`, que já filtram por
-- `status = 'SUCCESS'` sem índice dedicado pra essa coluna até aqui.
CREATE INDEX idx_canonical_deployments_status_started_at
  ON canonical_deployments (status, started_at);
