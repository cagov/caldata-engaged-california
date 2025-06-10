
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
FROM {{ source('ETHELO', 'COMMENTS') }} AS a
--  filter out comments from testers.
INNER JOIN {{ ref('stg_participants') }} AS b ON a.posted_by_id = b.participant_id
