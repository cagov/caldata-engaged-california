Select
    COMMENT_ID,
    REPLY_TO_ID,
    COMMENT_CONTENT,
    TOPIC,
    TARGET,
    TARGET_DESCRIPTION,
    REPLY_COUNT,
    FLAG_COUNT,
    LIKE_COUNT,
    POSTED_BY_ID,
    POSTED_ON,
    _FIVETRAN_SYNCED
From {{ ref('stg_ethelo_la_deliberation_comments') }}
