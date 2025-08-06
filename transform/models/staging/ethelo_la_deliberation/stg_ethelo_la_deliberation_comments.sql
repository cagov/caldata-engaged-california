/*This model preps the Comments data from Ethelo by removing all users likely to be ODI staff members,
moderators, or Ethelo staff, and re-formatting and joining data that was split across multiple tables in Airtable.
*/

--Pull all comments from the Comments table in Airtable
WITH raw_comments AS (
    SELECT
        to_varchar(comment_id) AS comment_id,
        array_to_string(odi_moderation_status, ',') AS odi_moderation_status,
        to_varchar(reply_to_id) AS reply_to_id,
        comment_content,
        array_to_string(posted_by_id, ',') AS airtable_posted_by_id,
        reply_count,
        like_count,
        flag_count,
        array_to_string(topic, ',') AS airtable_topic_id,
        array_to_string(target, ',') AS airtable_target_id,
        array_to_string(target_description, ',') AS target_description,
        posted_on,
        id AS airtable_id,
        _fivetran_synced
    FROM {{ source('ETHELO_LA_DELIBERATION', 'COMMENTS') }}
),

--Bring in key tables to include descriptive values for Topics and Targets
topics AS (
    SELECT
        id AS airtable_topic_id,
        name
    FROM {{ source('ETHELO_LA_DELIBERATION', 'TOPIC') }}
),

targets AS (
    SELECT
        id AS airtable_target_id,
        target
    FROM {{ source('ETHELO_LA_DELIBERATION', 'TOPIC_OPTIONS') }}
),

participants_filtered AS (
    SELECT
        participant_id,
        airtable_id
    FROM {{ ref('stg_ethelo_la_deliberation_participants') }}
)

SELECT
    a.comment_id,
    a.reply_to_id,
    a.comment_content,
    b.name AS topic,
    c.target,
    a.target_description,
    a.reply_count,
    a.flag_count,
    a.like_count,
    d.participant_id AS posted_by_id,
    a.posted_on,
    a._fivetran_synced

FROM raw_comments AS a
INNER JOIN topics AS b
    ON a.airtable_topic_id = b.airtable_topic_id
INNER JOIN targets AS c
    ON a.airtable_target_id = c.airtable_target_id
--  filter out comments from testers and bring in participant id
INNER JOIN participants_filtered AS d
    ON a.airtable_posted_by_id = d.airtable_id
--filter out any comment that is either removed or still pending moderation
WHERE a.odi_moderation_status = 'Approved'
