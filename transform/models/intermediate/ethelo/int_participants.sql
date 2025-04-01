{{ config( materialized='table') }}

WITH source_participants AS (
    SELECT *
    FROM {{ source('ETHELO', 'PARTICIPANTS') }}

),

seed_test_participants AS (
    // List of participant IDs known to be test accounts, from the seed file
    SELECT
        participant_id 
    FROM {{ ref('TEST_PARTICIPANTS') }}

),

filtered_participants AS (
    // Remove test participants from the source data via left join anti-pattern
    SELECT
        a.ID_NUMBER as participant_id,
        a.STATUS,
        a.ROLES,
        a.INFLUENCE,
        a.LAST_INVITE_SENT,
        a.VOTING_COMPLETE,
        a.SURVEY_COMPLETED,
        a.COMPLETION,
        a.COMMENT_COUNT,
        a.JOINED_ON,
        a.LAST_SIGN_IN

    FROM source_participants AS a
    LEFT JOIN seed_test_participants AS b
        ON a.ID_NUMBER = b.participant_id
    WHERE
        b.participant_id IS NULL // Keep only rows that *don't* match a test participant

)

SELECT * FROM filtered_participants