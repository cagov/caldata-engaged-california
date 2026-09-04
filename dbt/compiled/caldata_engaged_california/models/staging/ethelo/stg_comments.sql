SELECT
    a.comment_id,
    a.topic,
    a.type,
    a.target,
    a.posted_by_id,
    a.privacy,
    a.content,
    a.reply_to_id,
    a.posted_on,
    a.reply_count,
    a.flag_count,
    a.like_count,
    a._fivetran_synced

FROM RAW_ENGCA_PRD.AIRTABLE_ENGAGED_CA___LOS_ANGELES_FIRES_AGENDA_SETTING___SNOWFLAKE_APPZIJKCI0JPBHDTR.COMMENTS AS a
--  filter out comments from testers.
INNER JOIN TRANSFORM_ENGCA_PRD.ethelo.stg_participants AS b ON a.posted_by_id = b.participant_id