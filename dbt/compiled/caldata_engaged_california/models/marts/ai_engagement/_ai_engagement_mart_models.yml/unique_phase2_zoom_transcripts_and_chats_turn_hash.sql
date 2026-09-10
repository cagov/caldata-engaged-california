
    
    

select
    turn_hash as unique_field,
    count(*) as n_records

from ANALYTICS_ENGCA_PRD.ai_engagement.phase2_zoom_transcripts_and_chats
where turn_hash is not null
group by turn_hash
having count(*) > 1


