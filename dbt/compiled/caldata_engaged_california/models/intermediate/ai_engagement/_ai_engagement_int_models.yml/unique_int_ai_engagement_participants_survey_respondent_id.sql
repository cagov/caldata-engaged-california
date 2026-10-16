
    
    

select
    survey_respondent_id as unique_field,
    count(*) as n_records

from TRANSFORM_ENGCA_PRD.ai_engagement.int_ai_engagement_participants
where survey_respondent_id is not null
group by survey_respondent_id
having count(*) > 1


