





with validation_errors as (

    select
        session_id, turn_idx
    from ANALYTICS_ENGCA_PRD.ai_engagement.phase2_zoom_transcripts_and_chats
    group by session_id, turn_idx
    having count(*) > 1

)

select *
from validation_errors


