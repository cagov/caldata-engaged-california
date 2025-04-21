WITH source_comments AS (
    SELECT
        comment_id,
        topic,
        type,
        target,
        posted_by_id,
        privacy,
        content,
        reply_to_id,
        posted_on,
        reply_count,
        flag_count,
        like_count
    FROM {{ source('ETHELO', 'COMMENTS') }}

),

seed_test_participants AS (
    SELECT participant_id
    FROM {{ ref('TEST_PARTICIPANTS') }}

),

final AS (
    -- Join comments with test participants and filter out comments from testers.
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
        a.like_count

    FROM source_comments AS a
    LEFT JOIN seed_test_participants AS b
        -- Join based on the comment poster ID and the participant ID from the seed file.
        ON a.posted_by_id = b.participant_id
    WHERE
        -- Keep only comments where the poster ID was NOT found in the test participants list.
        b.participant_id IS NULL
)

SELECT * FROM final
