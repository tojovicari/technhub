package br.com.mondes.technhub.Tech.Hub.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor

@Entity
public class Impacto {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String descricao;

    @Column(nullable = false)
    private int impactoOperacional; // Nível de impacto nas operações da empresa (1 baixo a 5 alto)

    @Column(nullable = false)
    private int impactoNaCultura; // Nível de impacto na cultura e no ambiente da equipe (1 baixo a 5 alto)

    @Column(nullable = false)
    private boolean conhecimentoEssencial;

    @Column(nullable = false)
    private int dificuldadeSubstituicao; // Nível de dificuldade para encontrar um substituto (1 fácil a 5 difícil)

    @Column(nullable = false)
    private boolean liderançaInformal;

    @ManyToOne
    @JoinColumn(name = "risco_id")
    private Risco risco;

    // Getters, setters e construtores omitidos por brevidade
}