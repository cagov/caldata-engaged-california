
    
    

select
    participant_id as unique_field,
    count(*) as n_records

from TRANSFORM_ENGCA_PRD.ai_engagement.int_ai_engagement_participants
where participant_id is not null
group by participant_id
having count(*) > 1


