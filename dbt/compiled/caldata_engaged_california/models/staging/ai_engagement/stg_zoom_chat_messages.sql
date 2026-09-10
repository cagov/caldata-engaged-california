-- This model turns each raw Zoom chat file into
-- one row per chat MESSAGE, with a numeric timestamp, speaker, and the full text of the chat.
-- also changes exported formatting of chat messages that are replies to other messages,
-- to make it easier to identify the parent message and the reply message in the data.

WITH chats AS (SELECT * FROM RAW_ENGCA_PRD.ZOOM.CHATS_RAW),

-- Explode each file into one row per line of chat message, and tag each line with its session id.
split AS (
    SELECT
        chats.filename,
        REGEXP_SUBSTR(chats.filename, 'GMT[0-9]{8}-[0-9]{6}') AS session_id,
        l.index AS line_no,
        l.value::string AS line
    FROM chats,
        LATERAL SPLIT_TO_TABLE(
            REGEXP_REPLACE(
                REPLACE(chats.file_content, '\r', ''),
                '\n([0-9]{2}:[0-9]{2}:[0-9]{2}' || CHAR(9) || ')',
                CHAR(30) || '\\1'
            ),
            CHAR(30)
        ) AS l
    -- keep chunks that start with a timestamp. NOTE: Reply messages are structured
    -- in such a way that we need [\s\S]* (not .*) to find them.
    WHERE l.value RLIKE '^[0-9]{2}:[0-9]{2}:[0-9]{2}' || CHAR(9) || '[\\s\\S]*'
),

-- Parse the header fields (timestamp, speaker) and grab the raw body.
fields AS (
    SELECT
        filename,
        session_id,
        line_no,
        session_id || '-' || line_no AS message_id,

        --normalize timestamp into number of seconds since the start of the session:
        SPLIT_PART(SPLIT_PART(line, CHAR(9), 1), ':', 1)::int * 3600
        + SPLIT_PART(SPLIT_PART(line, CHAR(9), 1), ':', 2)::int * 60
        + SPLIT_PART(SPLIT_PART(line, CHAR(9), 1), ':', 3)::int AS start_sec,

        RTRIM(SPLIT_PART(line, CHAR(9), 2), ':') AS speaker,
        SPLIT_PART(line, CHAR(9), 3) AS body
    FROM split
),

-- Tag messasges that are replies, and clean text of unnecessary "Replying to ..." context lines.
parsed AS (
    SELECT
        filename,
        session_id,
        line_no,
        message_id,
        start_sec,
        speaker,

        STARTSWITH(body, 'Replying to "') AS is_reply,
        -- the snippet Zoom quotes from the parent message (used to locate the parent)
        REGEXP_SUBSTR(body, '^Replying to "(.*)"', 1, 1, 'e', 1) AS quoted_snippet,

        -- message text with the "Replying to ..." context line removed
        IFF(
            STARTSWITH(body, 'Replying to "'),
            REGEXP_REPLACE(body, '^Replying to ".*"\\s*', ''),
            body
        ) AS text
    FROM fields
),

joined AS (
    SELECT
        r.filename,
        r.session_id,
        r.line_no,
        r.message_id,
        r.start_sec,
        r.speaker,
        r.is_reply,
        p.message_id AS reply_to_message_id,
        r.text
    FROM parsed AS r
    -- For replies, find the parent by matching the quoted snippet against the start of
    -- another message's text (the quote is a prefix of the original, sometimes truncated
    -- with "...").
    LEFT JOIN parsed AS p
        ON
            r.is_reply
            AND r.session_id = p.session_id
            AND r.line_no <> p.line_no
            AND LENGTH(RTRIM(REGEXP_REPLACE(r.quoted_snippet, '\\.\\.\\.\\s*$', ''))) > 0
            AND STARTSWITH(p.text, RTRIM(REGEXP_REPLACE(r.quoted_snippet, '\\.\\.\\.\\s*$', '')))
    -- If the prefix matches more than one message, prefer a parent that comes before the
    -- reply, then the closest one:
    QUALIFY
        ROW_NUMBER() OVER (
            PARTITION BY r.message_id
            ORDER BY
                IFF(p.line_no < r.line_no, 0, 1),
                ABS(r.line_no - p.line_no)

        ) = 1
    ORDER BY r.session_id, r.line_no
)

SELECT
    r.filename,
    r.session_id,
    r.is_reply,
    r.reply_to_message_id,
    r.line_no,
    r.message_id,
    r.start_sec,
    r.speaker,
    r.text
FROM joined AS r
LEFT JOIN TRANSFORM_ENGCA_PRD.ai_engagement.stg_transcript_times AS w ON r.session_id = w.session_id
WHERE
    r.start_sec >= COALESCE(w.discussion_start_sec, r.start_sec)
    AND r.start_sec <= COALESCE(w.discussion_end_sec, r.start_sec)