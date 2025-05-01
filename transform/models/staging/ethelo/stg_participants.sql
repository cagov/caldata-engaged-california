WITH source_participants AS (
    SELECT *
    FROM {{ source('ETHELO', 'PARTICIPANTS') }}

),

seed_test_participants AS (
    // List of participant IDs known to be test accounts, from the seed file
    SELECT participant_id
    FROM {{ ref('TEST_PARTICIPANTS') }}

),

filtered_participants AS (
    // Remove test participants from the source data
    SELECT
        a.id_number AS participant_id,
        a.status,
        a.roles,
        a.influence,
        a.last_invite_sent,
        a.voting_complete,
        a.survey_completed,
        a.completion,
        a.comment_count,
        a.joined_on,
        a.last_sign_in,
        a.resent_invite,
        a.successful_reinvite
    FROM source_participants AS a
    // We have some records that are from test accounts that are marked as ['Participant'].
    // Remove them via the seed table that identifies them by participant_id
    LEFT JOIN seed_test_participants AS b
        ON a.id_number = b.participant_id
    WHERE
        b.participant_id IS NULL // Keep only rows that *don't* match a test participant
        // there are some records not in our seed table that are not participants. Remove them as well.
        AND a.roles = ['Participant']
)

SELECT * FROM filtered_participants
