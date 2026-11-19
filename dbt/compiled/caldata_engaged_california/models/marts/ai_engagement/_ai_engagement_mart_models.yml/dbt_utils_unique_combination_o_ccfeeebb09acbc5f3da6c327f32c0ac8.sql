





with validation_errors as (

    select
        session_id, section, theme_seq
    from ANALYTICS_ENGCA_PRD.ai_engagement.phase2_transcript_session_summaries
    group by session_id, section, theme_seq
    having count(*) > 1

)

select *
from validation_errors


