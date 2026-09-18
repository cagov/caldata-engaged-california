WITH

transcripts AS (
    SELECT * FROM {{ ref('stg_zoom_transcript_cues') }}
),

chats AS (
    SELECT * FROM {{ ref('stg_zoom_chat_messages') }}
),

speakers AS (
    SELECT
        session_id,
        speaker
    FROM transcripts
    UNION DISTINCT
    SELECT
        session_id,
        speaker
    FROM chats
)

SELECT
    session_id,
    speaker,
    md5(speaker || '|' || session_id) AS speaker_id
FROM speakers
