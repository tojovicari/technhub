-- Captura o team_id bruto do provedor de origem (resolvido via serviço no
-- Waroom, já que lá o time pertence ao serviço, não ao incidente
-- diretamente). Não é mapeado pra teams.id da plataforma ainda — isso fica
-- pra uma feature futura de mapeamento externo-time -> nosso time.
ALTER TABLE canonical_incidents ADD COLUMN external_team_id VARCHAR(255);
