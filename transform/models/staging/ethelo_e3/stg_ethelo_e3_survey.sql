WITH survey_responses AS (
    SELECT *
    FROM {{ source('GOOGLE_DRIVE_CONNECTOR', 'E_3_SURVEY_BY_QUESTION') }}
    QUALIFY
        _modified = max(_modified) OVER () -- filter to latest upload
),

participants_filtered AS (
    SELECT *
    FROM {{ ref('stg_ethelo_e3_participants') }}
),

final AS (
    SELECT
        a."GROUP" AS survey_group,
        a.question,
        a.answer,
        a.participant AS participant_id,
        a.date AS response_date,
        a.joined_date,
        a._fivetran_synced,
        a._modified AS _file_upload_date
    FROM survey_responses AS a
    --filter out staff and test accounts:
    INNER JOIN participants_filtered AS b ON a.participant = b.participant_id
    --filter out test and since-deleted questions:
    WHERE a.question IN (
        'State of California employee certification',
        'Civility pledge agreement',
        'Moderation policy agreement',
        'Moderation policy agreement - I am 18 or older',
        'About you - Position type',
        'About you - How long have you worked for the State of California?',
        'Opening question - What makes you proud about your role in public service?',
        'Share your idea - Which department or agency does your idea apply to?'
    )
)

SELECT DISTINCT * FROM final
