package br.com.mondes.technhub.Tech.Hub.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.springframework.data.annotation.CreatedDate;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor

@Entity
public class Projeto {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @CreatedDate
    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false, length = 50)
    private String nome;

    @Column(nullable = false, length = 255)
    private String descricao;

    @Column(nullable = false)
    private LocalDate dataPrevista;

    @Column(nullable = false)
    private LocalDate dataRealizada;

    @Column(nullable = false)
    private String status; // A definir (ex: Aberto, Em Andamento, Concluído, Cancelado)

    @OneToMany(mappedBy = "projeto")
    private Set<Tarefa> tarefas = new HashSet<>();

}