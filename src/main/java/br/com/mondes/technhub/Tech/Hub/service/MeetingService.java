package br.com.mondes.technhub.Tech.Hub.service;

import br.com.mondes.technhub.Tech.Hub.model.Meeting;
import br.com.mondes.technhub.Tech.Hub.model.repository.MeetingRepository;
import br.com.mondes.technhub.Tech.Hub.model.repository.PessoaRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class MeetingService {

    @Autowired
    private MeetingRepository meetingRepository;

    @Autowired
    private PessoaRepository pessoaRepository;

    public Meeting criarMeeting(Meeting meeting){
        //ToDO: Validações faltantes
        return meetingRepository.save(meeting);
    }

    public Meeting buscarMeetingPorId(Long id){
        return meetingRepository.findById(id).orElse(null);
    }

}
