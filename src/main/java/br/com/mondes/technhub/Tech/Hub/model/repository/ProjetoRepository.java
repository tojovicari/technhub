package br.com.mondes.technhub.Tech.Hub.model.repository;

import br.com.mondes.technhub.Tech.Hub.model.Projeto;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjetoRepository extends JpaRepository<Projeto, Long> {
}
