WITH
transcript_turns as (select * from {{ ref('int_phase2_transcript_turns') }}
),

chats as (select * from {{ ref('stg_chats_raw') }}
)

--combine the transcript turns and the chat messages into one table of all Zoom engagement, with a common set of columns:
SELECT
  session_id,
  'speech'   AS source,
  start_seq  AS src_ref,         
  start_sec, end_sec, speaker, text
FROM transcript_turns
UNION ALL
SELECT
  session_id,
  'chat'     AS source,
  line_no    AS src_ref,
  start_sec,
  start_sec  AS end_sec,          
  speaker, text
FROM chats
ORDER BY session_id, start_sec
