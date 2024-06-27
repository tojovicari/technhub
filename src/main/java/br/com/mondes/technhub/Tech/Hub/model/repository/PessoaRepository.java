package br.com.mondes.technhub.Tech.Hub.model.repository;

import br.com.mondes.technhub.Tech.Hub.model.Pessoa;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PessoaRepository extends JpaRepository<Pessoa, Long> {
}
