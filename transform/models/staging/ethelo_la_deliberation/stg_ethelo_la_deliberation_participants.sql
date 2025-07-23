/*This model preps the Participants data from Ethelo by removing all users likely to be ODI staff members,
moderators, or Ethelo staff.
*/ 

--Pull all participants from the Participants table in Airtable
WITH source_participants AS (
    SELECT *
    FROM {{ source('ETHELO_LA_DELIBERATION', 'PARTICIPANTS') }}
),

--List of participant IDs known to be test accounts
test_participants AS (
    SELECT array_to_string(participant, ',') as id
    FROM {{ source('ETHELO_LA_DELIBERATION', 'BETA_TESTERS') }}
),

filtered_participants AS (
    SELECT
        a.id_number as participant_id,
        a.status,
        a.influence,
        a.roles,
        a.voting_complete,
        a.survey_completed,
        a.completion, 
        a.last_invite_sent,
        a.last_sign_in,
        a.joined_on,
        a.id as airtable_id,
        a._fivetran_synced
    FROM source_participants AS a
    --Remove ODI, GovOps, GO, and Ethelo test accounts by beta_testers list:
    LEFT JOIN test_participants AS b
        ON a.id = b.id
    --Remove any user who has a role in Ethelo other than just 'Participant'
    WHERE a.roles = ['Participant']
    --Remove any user whose Influence is set to 0
    AND a.influence > 0
)

SELECT * FROM filtered_participants
