package br.com.mondes.technhub.Tech.Hub.model.repository;

import br.com.mondes.technhub.Tech.Hub.model.Mood;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MoodRepository extends JpaRepository<Mood, Long> {
}
