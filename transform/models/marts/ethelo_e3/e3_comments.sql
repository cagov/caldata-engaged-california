Select
    COMMENT_ID,
    REPLY_TO_ID,
    PARTICIPANT_ID,
    CONTENT,
    QUESTION,
    POSTED_ON,
    LIKE_COUNT,
    _FILE_UPLOAD_DATE
From {{ ref('int_ethelo_e3_comments_and_responses') }}
