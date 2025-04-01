{{ config(materialized='table')}}

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

SELECT 
    CONVERT_TIMEZONE('America/Los_Angeles', MAX(LATEST_DATE)) AS latest_date 
FROM (
    SELECT MAX(POSTED_ON) AS LATEST_DATE FROM comments WHERE POSTED_ON IS NOT NULL
    UNION
    SELECT MAX(SURVEY_JOIN_DATE) AS LATEST_DATE FROM survey_responses WHERE SURVEY_JOIN_DATE IS NOT NULL
    UNION
    SELECT max(LAST_SIGN_IN) AS LATEST_DATE FROM participants
)