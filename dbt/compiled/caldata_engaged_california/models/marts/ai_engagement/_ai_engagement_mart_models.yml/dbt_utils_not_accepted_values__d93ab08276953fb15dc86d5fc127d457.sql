
with all_values as (

    select distinct
        tag_status as value_field

    from ANALYTICS_ENGCA_PRD.ai_engagement.phase2_transcript_curated_theme_tags

),

validation_errors as (

    select
        value_field

    from all_values
    where value_field in (
        'FAILED'
        )

)

select *
from validation_errors

