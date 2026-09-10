





with validation_errors as (

    select
        session_id, policy_concept_id, turn_hash
    from ANALYTICS_ENGCA_PRD.ai_engagement.phase2_transcript_curated_theme_tag_reviews
    group by session_id, policy_concept_id, turn_hash
    having count(*) > 1

)

select *
from validation_errors


