--This creates non-overlapping ~400-word windows over turns. 
-- Accomplishes two things. attempts to get relevant context for ideas that span multiple speakers; 
-- and creates 500-ish token units to feed to Cortex Search / embeddings. 500 tokens = ~350 words

WITH events as (
  SELECT * FROM {{ ref('phase2_zoom_transcripts_and_chats') }} ),

word_counts as (
  SELECT session_id, source, src_ref, start_sec, end_sec, speaker, text,
         REGEXP_COUNT(text, '[^ ]+') AS word_count
  FROM events
),

numbered AS (
  SELECT *,
    COALESCE(SUM(word_count) OVER (
      PARTITION BY session_id ORDER BY start_sec
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS words_before
  FROM word_counts
),

assigned AS (
  SELECT *,
    DENSE_RANK() OVER (PARTITION BY session_id
                       ORDER BY FLOOR(words_before / 350)) AS raw_chunk_no
  FROM numbered
),

sized AS (
  SELECT *,
    SUM(word_count) OVER (PARTITION BY session_id, raw_chunk_no) AS chunk_words,
    MAX(raw_chunk_no) OVER (PARTITION BY session_id)            AS last_chunk_no
  FROM assigned
),

merged AS (
  SELECT *,
    CASE WHEN raw_chunk_no = last_chunk_no AND chunk_words < 75
         THEN raw_chunk_no - 1 ELSE raw_chunk_no END AS chunk_no
  FROM sized
)

SELECT
  session_id,
  chunk_no,
  session_id || '_chunk_' || LPAD(chunk_no, 4, '0') AS chunk_id,
  MIN(start_sec)                                    AS start_sec,
  MAX(end_sec)                                      AS end_sec,
  LISTAGG(DISTINCT speaker, ', ')                   AS speakers,
  BOOLOR_AGG(source = 'chat')                       AS has_chat,
  LISTAGG(
    CASE WHEN source = 'chat' THEN '[chat] ' ELSE '' END
      || COALESCE(speaker || ': ', '') || text,
    '\n') WITHIN GROUP (ORDER BY start_sec)         AS text,
  SUM(word_count)                                   AS word_count
FROM merged
GROUP BY session_id, chunk_no
ORDER BY session_id, chunk_no



