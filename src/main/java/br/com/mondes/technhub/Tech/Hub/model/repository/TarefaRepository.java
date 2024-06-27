package br.com.mondes.technhub.Tech.Hub.model.repository;

import br.com.mondes.technhub.Tech.Hub.model.Tarefa;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TarefaRepository extends JpaRepository<Tarefa, Long> {
}
