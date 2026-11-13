
    
    

with child as (
    select policy_concept_id as from_field
    from ANALYTICS_ENGCA_PRD.ai_engagement.phase2_transcript_curated_theme_tags
    where policy_concept_id is not null
),

parent as (
    select policy_concept_id as to_field
    from TRANSFORM_ENGCA_PRD.ai_engagement.stg_phase2_policy_concepts_and_themes
)

select
    from_field

from child
left join parent
    on child.from_field = parent.to_field

where parent.to_field is null


