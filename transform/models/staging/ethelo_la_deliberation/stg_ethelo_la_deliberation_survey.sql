WITH survey_responses AS (
    SELECT
        *,
        array_to_string(participant, ',') AS airtable_id
    FROM {{ source('ETHELO_LA_DELIBERATION', 'SURVEY_BY_QUESTION') }}
),

participants_filtered AS (
    SELECT *
    FROM {{ ref('stg_ethelo_la_deliberation_participants') }}
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
