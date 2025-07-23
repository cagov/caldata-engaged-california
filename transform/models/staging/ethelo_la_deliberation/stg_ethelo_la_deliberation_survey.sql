WITH survey_responses as (
    SELECT *
    FROM {{ source('ETHELO_LA_DELIBERATION', 'SURVEY_BY_QUESTION') }}
),

participants_filtered AS (
    SELECT *
    FROM {{ ref('stg_ethelo_la_deliberation_participants') }}
),

final AS (
    SELECT
    a."GROUP" as survey_group,
    a.question,
    a.answer, 
    a.participant as participant_id, 
    a.date as response_date,
    a.joined_date,
    a._fivetran_synced
    FROM survey_responses AS a
    --filter out staff and test accounts:
    INNER JOIN participants_filtered AS b ON a.participant = b.participant_id
)

SELECT * FROM final
