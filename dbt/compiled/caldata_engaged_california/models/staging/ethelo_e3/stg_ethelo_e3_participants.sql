/*This model preps the Participants data from Ethelo by removing all users likely to be ODI staff members,
moderators, or Ethelo staff.
*/

--Pull all participants from the Participants table in Airtable
WITH source_participants AS (
    SELECT *
    FROM RAW_ENGCA_PRD.ENGAGEDCA_GOOGLE_DRIVE.E_3_PARTICIPANTS
    QUALIFY
        _modified = max(_modified) OVER () -- filter to latest upload
),

filtered_participants AS (
    SELECT
        source_participants.id_number AS participant_id,
        source_participants.status,
        source_participants.influence,
        source_participants.roles,
        source_participants.voting_complete AS voting_completed,
        source_participants.survey_completed,
        source_participants.completion,
        to_timestamp_tz(source_participants.last_invite_sent, 'YYYY-MM-DD"T"HH24:MI:SSTZHTZM') AS last_invite_sent,
        to_timestamp_tz(source_participants.last_sign_in, 'YYYY-MM-DD"T"HH24:MI:SSTZHTZM') AS last_sign_in,
        to_timestamp_tz(source_participants.joined_on, 'YYYY-MM-DD"T"HH24:MI:SSTZHTZM') AS joined_on,
        source_participants._fivetran_synced,
        source_participants._modified AS _file_upload_date
    FROM source_participants
    WHERE
        --Remove any user who does not have the 'Participant' role in Ethelo
        source_participants.roles LIKE '%Participant%'
        --Remove any user whose Influence is set to 0
        AND source_participants.influence > 0

)

SELECT * FROM filtered_participants