package br.com.mondes.technhub.Tech.Hub.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.springframework.data.annotation.CreatedDate;

import java.time.LocalDateTime;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor

@Entity
public class Risco {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @CreatedDate
    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private String descricao;

    @Column(nullable = false)
    private int probabilidade; // 1% a 100%

    @Column(nullable = false)
    private int riscoSaida; // 1 (baixo) a 5 (muito alto)

    @ManyToOne
    @JoinColumn(name = "pessoa_id")
    private Pessoa pessoa;

}