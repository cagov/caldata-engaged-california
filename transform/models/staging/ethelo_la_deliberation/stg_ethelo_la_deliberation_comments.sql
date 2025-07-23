/*This model preps the Comments data from Ethelo by removing all users likely to be ODI staff members,
moderators, or Ethelo staff, and re-formatting and joining data that was split across multiple tables in Airtable.
*/ 

--Pull all comments from the Comments table in Airtable
WITH raw_comments AS (
    SELECT 
        to_varchar(comment_id) as comment_id,
        to_varchar(reply_to_id) as reply_to_id,
        comment_content,
        array_to_string(posted_by_id, ',') as airtable_posted_by_id,
        reply_count,
        like_count,
        flag_count,
        array_to_string(topic, ',') as airtable_topic_id,
        array_to_string(target,',') as airtable_target_id,
        array_to_string(target_description,',') as target_description,
        posted_on,
        id as airtable_id,
        _fivetran_synced
    FROM {{ source('ETHELO_LA_DELIBERATION', 'COMMENTS') }}
),

--Bring in key tables to include descriptive values for Topics and Targets
topics AS (
    SELECT 
        id as airtable_topic_id,
        name,
    FROM {{ source('ETHELO_LA_DELIBERATION', 'TOPIC') }}
),

targets AS (
    SELECT 
        id as airtable_target_id,
        target
    FROM {{ source('ETHELO_LA_DELIBERATION', 'TOPIC_OPTIONS') }}
),

participants_filtered as (
    select 
        participant_id,
        airtable_id
    from {{ ref('stg_ethelo_la_deliberation_participants') }}
)


SELECT
    a.comment_id,
    a.reply_to_id,
    a.comment_content,
    b.name as topic,
    c.target,
    a.target_description,
    a.reply_count,
    a.flag_count,
    a.like_count,
    d.participant_id AS posted_by_id,
    a.posted_on,
    a._fivetran_synced

FROM raw_comments as a
INNER JOIN topics as b
on a.airtable_topic_id = b.airtable_topic_id
INNER JOIN targets as c
on a.airtable_target_id = c.airtable_target_id
--  filter out comments from testers and bring in participant id
INNER JOIN participants_filtered as d
ON a.airtable_posted_by_id = d.airtable_id
