-- Suporte a filtro de período em GET .../teams/:teamId/profile/contributors
-- (filtro por completed_at, WHERE de verdade, não FILTER pós-leitura —
-- precisa de índice pra Postgres pular linha fora da janela em vez de
-- sequential scan). Benefit colateral: GET .../profile/history já filtra
-- por completed_at pro mesmo team_id, sem índice dedicado até agora.
CREATE INDEX idx_enriched_work_items_team_completed_at
    ON enriched_work_items (team_id, completed_at);
