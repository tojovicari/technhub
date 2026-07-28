-- Nome de exibição do time externo (resolvido via GET /v1/teams no Waroom),
-- separado de external_team_id de propósito: o ID precisa sobreviver
-- estável pro futuro mapeamento externo-time -> teams.id da plataforma; o
-- nome é só pra exibição/debug.
ALTER TABLE canonical_incidents ADD COLUMN external_team_name VARCHAR(255);
