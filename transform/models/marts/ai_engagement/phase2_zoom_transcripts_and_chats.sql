WITH
transcript_turns AS (SELECT * FROM {{ ref('int_phase2_transcript_turns') }}
),

chats AS (SELECT * FROM {{ ref('stg_zoom_chat_messages') }}
)

--combine the transcript turns and the chat messages into one table of all Zoom engagement,
-- with a common set of columns:
SELECT
    session_id,
    'speech' AS source,
    start_seq AS src_ref,
    start_sec,
    end_sec,
    speaker,
    text
FROM transcript_turns
UNION ALL
SELECT
    session_id,
    'chat' AS source,
    line_no AS src_ref,
    start_sec,
    start_sec AS end_sec,
    speaker,
    text
FROM chats
ORDER BY session_id, start_sec
