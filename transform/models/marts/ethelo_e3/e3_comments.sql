Select
    COMMENT_ID,
    REPLY_TO_ID,
    PARTICIPANT_ID,
    CONTENT,
    QUESTION,
    POSTED_ON,
    _FILE_UPLOAD_DATE
From {{ ref('int_ethelo_e3_comments_and_responses') }}
Where POSTED_ON >= '2025-08-15'
