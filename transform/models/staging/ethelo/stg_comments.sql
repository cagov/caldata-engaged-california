{{ config( materialized='view') }}
WITH source_comments AS (
    SELECT
        COMMENT_ID,
        TOPIC,
        TYPE,
        TARGET,
        POSTED_BY_ID,
        PRIVACY,
        CONTENT,
        REPLY_TO_ID,
        POSTED_ON, 
        REPLY_COUNT,
        FLAG_COUNT,
        LIKE_COUNT
    FROM {{ source('ETHELO', 'COMMENTS') }}

),

seed_test_participants AS (
    SELECT
        participant_id 
    FROM {{ ref('TEST_PARTICIPANTS') }}

),

final AS (
    -- Join comments with test participants and filter out comments from testers.
    SELECT
        a.COMMENT_ID,
        a.TOPIC,
        a.TYPE,
        a.TARGET,
        a.POSTED_BY_ID,
        a.PRIVACY,
        a.CONTENT,
        a.REPLY_TO_ID,
        a.POSTED_ON,
        a.REPLY_COUNT,
        a.FLAG_COUNT,
        a.LIKE_COUNT

    FROM source_comments AS a
    LEFT JOIN seed_test_participants AS b
        -- Join based on the comment poster ID and the participant ID from the seed file.
        ON a.POSTED_BY_ID = b.participant_id
    WHERE
        -- Keep only comments where the poster ID was NOT found in the test participants list.
        b.participant_id IS NULL
)

SELECT * FROM final