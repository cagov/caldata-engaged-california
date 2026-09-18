WITH
transcript_turns AS (SELECT * FROM {{ ref('int_phase2_transcript_turns') }}
),

chats AS (SELECT * FROM {{ ref('stg_zoom_chat_messages') }}
),

--combine the transcript turns and the chat messages into one table of all Zoom engagement,
-- with a common set of columns:
combined AS (
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
)

SELECT
    *,
    -- turn_hash: stable, content-addressed identity for a turn. It depends only on the turn's
    -- own source record and content, never on which other turns survive upstream filters.
    -- It changes if the turn's speaker or text changes,
    -- which is exactly when a summary citing it needs to be redone.
    MD5(
        session_id || '|' || source || '|' || src_ref || '|'
        || COALESCE(speaker, '') || '|' || COALESCE(text, '')
    ) AS turn_hash,
    -- turn_idx: per-session chronological index over all events (speech and chat
    -- interleaved). It is positional, so it renumbers whenever upstream filters change.
    ROW_NUMBER() OVER (
        PARTITION BY session_id
        ORDER BY start_sec ASC, source ASC, src_ref ASC
    ) - 1 AS turn_idx
FROM combined
ORDER BY session_id, start_sec
