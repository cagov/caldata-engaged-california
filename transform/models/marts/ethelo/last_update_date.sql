WITH survey_responses AS (
    -- Upstream staging model containing cleaned survey data
    SELECT * FROM {{ ref('stg_survey') }}
),

participants AS (
    SELECT * FROM {{ source('ETHELO', 'PARTICIPANTS') }}
),

comments AS (
    -- Upstream staging model containing cleaned comment data
    SELECT * FROM {{ ref('stg_comments') }}
)

SELECT CONVERT_TIMEZONE('America/Los_Angeles', MAX(latest_date)) AS latest_date
FROM (
    SELECT MAX(posted_on) AS latest_date FROM comments
    WHERE posted_on IS NOT NULL
    UNION DISTINCT
    SELECT MAX(survey_join_date) AS latest_date FROM survey_responses
    WHERE survey_join_date IS NOT NULL
    UNION DISTINCT
    SELECT MAX(last_sign_in) AS latest_date FROM participants
)
