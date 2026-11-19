
    
    

select
    policy_concept_id as unique_field,
    count(*) as n_records

from TRANSFORM_ENGCA_PRD.ai_engagement.stg_phase2_policy_concepts_and_themes
where policy_concept_id is not null
group by policy_concept_id
having count(*) > 1


