WITH
transcript_turns AS (SELECT * FROM {{ ref('int_phase2_transcript_turns') }}
),

chats AS (SELECT * FROM {{ ref('stg_chats_raw') }}
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
    -- turn_idx: per-session chronological index over all events (speech and chat
    -- interleaved). The AI tagging models cite turns by this index and resolve verbatim
    -- text from this table, so the ordering ties are broken deterministically (source,
    -- then src_ref) to keep turn_idx stable across rebuilds.
    ROW_NUMBER() OVER (
        PARTITION BY session_id
        ORDER BY start_sec ASC, source ASC, src_ref ASC
    ) - 1 AS turn_idx
FROM combined
ORDER BY session_id, start_sec
