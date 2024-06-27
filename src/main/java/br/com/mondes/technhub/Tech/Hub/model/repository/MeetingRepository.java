package br.com.mondes.technhub.Tech.Hub.model.repository;

import br.com.mondes.technhub.Tech.Hub.model.Meeting;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface MeetingRepository extends JpaRepository<Meeting, Long> {
    List<Meeting> findByParticipantes_Id(Long pessoaId); // Método para buscar reuniões por participante
}