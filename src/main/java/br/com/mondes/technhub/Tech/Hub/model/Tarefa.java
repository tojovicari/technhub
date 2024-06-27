package br.com.mondes.technhub.Tech.Hub.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.springframework.data.annotation.CreatedDate;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor

@Entity
public class Tarefa {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @CreatedDate
    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false, length = 50)
    private String titulo;

    @Column(nullable = false, length = 255)
    private String descricao;

    @Column(nullable = false)
    private LocalDate dataPrevista;

    @Column(nullable = false)
    private LocalDate dataRealizada;

    @Column(nullable = false)
    private String status; // A definir (ex: Pendente, Em Andamento, Concluído, Cancelado)

    @ManyToOne
    @JoinColumn(name = "responsavel_id")
    private Pessoa responsavel;

    @ManyToOne
    @JoinColumn(name = "projeto_id")
    private Projeto projeto;

}
