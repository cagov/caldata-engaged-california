
    
    

select
    PARTICIPANT_ID as unique_field,
    count(*) as n_records

from TRANSFORM_ENGCA_PRD.ethelo_e3.int_participant_survey_responses
where PARTICIPANT_ID is not null
group by PARTICIPANT_ID
having count(*) > 1


