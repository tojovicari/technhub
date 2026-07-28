-- Índice pra filtro futuro por time externo (ver plano de mapeamento
-- external_team_id -> teams.id, ainda não implementado).
CREATE INDEX idx_canonical_incidents_external_team_id ON canonical_incidents (external_team_id);
