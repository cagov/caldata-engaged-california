/*This model preps the Participants data from Ethelo by removing all users likely to be ODI staff members,
moderators, or Ethelo staff.
*/

--Pull all participants from the Participants table in Airtable
WITH source_participants AS (
    SELECT *
    FROM {{ source('ETHELO_LA_DELIBERATION', 'DELIBERATION_PARTICIPANTS') }}
),

--List of participant IDs known to be test accounts
test_participants AS (
    SELECT array_to_string(participant, ',') AS id
    FROM {{ source('ETHELO_LA_DELIBERATION', 'BETA_TESTERS') }}
    WHERE participant IS NOT null
),

filtered_participants AS (
    SELECT
        source_participants.id_number AS participant_id,
        source_participants.status,
        source_participants.influence,
        source_participants.roles,
        source_participants.voting_complete,
        source_participants.survey_completed,
        source_participants.completion,
        source_participants.last_invite_sent,
        source_participants.last_sign_in,
        source_participants.joined_on,
        source_participants.id AS airtable_id,
        source_participants._fivetran_synced
    FROM source_participants
    WHERE
    --Remove ODI, GovOps, GO, and Ethelo test accounts by beta_testers list:
        source_participants.id NOT IN (SELECT test_participants.id FROM test_participants)
        --Remove any user who has a role in Ethelo other than just 'Participant'
        AND source_participants.roles = ['Participant']
        --Remove any user whose Influence is set to 0
        AND source_participants.influence > 0

)

SELECT * FROM filtered_participants
