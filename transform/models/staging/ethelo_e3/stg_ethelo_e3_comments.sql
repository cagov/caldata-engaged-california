/*This model preps the Comments data from Ethelo by removing all users likely to be ODI staff members,
moderators, or Ethelo staff, and re-formatting and joining data that was split across multiple tables in Airtable.
*/

--Pull all comments from the Comments table in Airtable
WITH raw_comments AS (
    SELECT
        to_varchar(comment_id) AS comment_id,
        to_varchar(reply_to_id) AS reply_to_id,
        content AS comment_content,
        posted_by_id,
        reply_count,
        like_count,
        flag_count,
        type,
        target,
        posted_on,
        CONVERT_TIMEZONE(
            'America/Los_Angeles',
            TO_TIMESTAMP_TZ(posted_on, 'YYYY-MM-DD"T"HH24:MI:SSTZHTZM')
            )::TIMESTAMP_NTZ AS posted_on_pacific_tz,
        _fivetran_synced,
        _modified as _file_upload_date
    FROM {{ source('GOOGLE_DRIVE_CONNECTOR', 'E_3_COMMENTS') }}
    QUALIFY
        _modified = max(_modified) over () -- filter to latest upload
),
participants_filtered AS (
    SELECT
        participant_id
    FROM {{ ref('stg_ethelo_e3_participants') }}
)

SELECT
    a.comment_id,
    a.reply_to_id,
    a.comment_content,
    a.posted_by_id,
    a.reply_count,
    a.like_count,
    a.type,
    a.target,
    a.posted_on,
    --create a column that marks any comment posted before 5pm the day before as approved:
    case when a.posted_on_pacific_tz <= DATEADD(hour, 17, DATEADD(day, -1, CURRENT_DATE))
    THEN 'moderator approved' ELSE 'not yet moderated' END AS odi_moderation_status,
    a._fivetran_synced,
    a._file_upload_date

FROM raw_comments AS a
--  filter out comments from testers 
INNER JOIN participants_filtered AS b
    ON a.posted_by_id = b.participant_id

