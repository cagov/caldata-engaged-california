/*This model preps the Participants data from Ethelo by removing all users likely to be ODI staff members,
moderators, or Ethelo staff.
*/

--Pull all participants from the Participants table in Airtable
WITH source_participants AS (
    SELECT *
    FROM {{ source('GOOGLE_DRIVE_CONNECTOR', 'E_3_PARTICIPANTS') }}
    QUALIFY
        _modified = max(_modified) over () -- filter to latest upload
),

filtered_participants AS (
    SELECT
        source_participants.id_number AS participant_id,
        source_participants.status,
        source_participants.influence,
        source_participants.roles,
        source_participants.voting_complete as voting_completed,
        source_participants.survey_completed,
        source_participants.completion,
        source_participants.last_invite_sent,
        source_participants.last_sign_in,
        source_participants.joined_on,
        source_participants._fivetran_synced,
        source_participants._modified as _file_upload_date
    FROM source_participants
    WHERE
        --Remove any user who has a role in Ethelo other than just 'Participant'
        source_participants.roles = 'Participant'
        --Remove any user whose Influence is set to 0
        AND source_participants.influence > 0

)

SELECT * FROM filtered_participants
