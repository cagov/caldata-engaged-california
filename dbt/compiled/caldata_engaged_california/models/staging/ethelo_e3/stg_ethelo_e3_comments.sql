/*This model preps the Comments data from Ethelo by removing all users likely to be ODI staff members,
moderators, or Ethelo staff, and marking comments that were posted before 5pm the day before as
"moderator approved".
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
        convert_timezone(
            'America/Los_Angeles',
            to_timestamp_tz(posted_on, 'YYYY-MM-DD"T"HH24:MI:SSTZHTZM')
        )::TIMESTAMP_NTZ AS posted_on_pacific_tz,
        _fivetran_synced,
        _modified AS _file_upload_date
    FROM RAW_ENGCA_PRD.ENGAGEDCA_GOOGLE_DRIVE.E_3_COMMENTS
    QUALIFY
        _modified = max(_modified) OVER () -- filter to latest upload
),

participants_filtered AS (
    SELECT participant_id
    FROM TRANSFORM_ENGCA_PRD.ethelo_e3.stg_ethelo_e3_participants
)

SELECT
    a.comment_id,
    a.reply_to_id,
    a.comment_content,
    a.posted_by_id,
    a.reply_count,
    a.like_count,
    a.type,
    CASE WHEN
        a.target LIKE '%been working - Examples'
        THEN 'Share what has been working - Examples'
    ELSE a.target END AS target,
    a.posted_on,
    --create a column that marks any comment posted before 5pm the day before as approved:
    CASE
        WHEN a.posted_on_pacific_tz <= dateadd(HOUR, 17, dateadd(DAY, -1, current_date))
            THEN 'moderator approved'
        ELSE 'not yet moderated'
    END AS odi_moderation_status,
    a._fivetran_synced,
    a._file_upload_date

FROM raw_comments AS a
--  filter out comments from testers
INNER JOIN participants_filtered AS b
    ON a.posted_by_id = b.participant_id
--  filter out comments posted before engagement began
WHERE a.posted_on >= '2025-08-15'