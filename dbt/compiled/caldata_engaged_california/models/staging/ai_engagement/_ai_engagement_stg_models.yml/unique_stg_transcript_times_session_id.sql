
    
    

select
    session_id as unique_field,
    count(*) as n_records

from TRANSFORM_ENGCA_PRD.ai_engagement.stg_transcript_times
where session_id is not null
group by session_id
having count(*) > 1


