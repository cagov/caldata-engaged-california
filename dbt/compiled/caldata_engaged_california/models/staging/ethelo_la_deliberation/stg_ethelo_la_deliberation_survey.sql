WITH survey_responses AS (
    SELECT
        *,
        array_to_string(participant, ',') AS airtable_id
    FROM RAW_ENGCA_PRD.AIRTABLE_SENSITIVE_PII___LOS_ANGELES_FIRES_RECOVERY_DELIBERATION___SNOWFLAKE_SYNC___ADMIN_ONLY_APPKMTPH1VALYNZLY.SURVEY_BY_QUESTION
),

participants_filtered AS (
    SELECT *
    FROM TRANSFORM_ENGCA_PRD.ethelo_la_deliberation.stg_ethelo_la_deliberation_participants
),

final AS (
    SELECT
        a."GROUP" AS survey_group,
        a.question,
        a.answer,
        b.participant_id,
        a.date AS response_date,
        a.joined_date,
        a._fivetran_synced
    FROM survey_responses AS a
    --filter out staff and test accounts:
    INNER JOIN participants_filtered AS b ON a.airtable_id = b.airtable_id
)

SELECT * FROM final