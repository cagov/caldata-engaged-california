-- Group all sequential transcript lines (or 'cues') by the same person in a row together into "turns"
-- (e.g. 8 consecutive Participant A cues == 1 Participant A turn).

with
cues as (
    select
        *
    from {{ ref('stg_transcripts_raw') }}),

  -- Mark where the speaker changes: 1 = new turn starts here, 0 = same speaker as previous row.
flagged AS (
  SELECT *,
    CASE WHEN speaker IS NOT DISTINCT FROM
         LAG(speaker) OVER (PARTITION BY filename ORDER BY seq)
         THEN 0 ELSE 1 END AS is_new_turn
  FROM cues
),


-- Create a running total of the 0/1 flags = a turn id. It ticks up by 1 at each speaker
-- change and stays flat within a turn, so all rows of one turn share a turn_grp.
grouped AS (
  SELECT *,
    SUM(is_new_turn) OVER (PARTITION BY filename ORDER BY seq) AS turn_grp
  FROM flagged
)


SELECT
  session_id,
  filename,
  MIN(seq)                                       AS start_seq,
  MAX(seq)                                       AS end_seq,
  ANY_VALUE(speaker)                             AS speaker,-- every row in the group has the same speaker; grab any
  min(start_sec)                                  as start_sec,
  MAX(end_sec)                                   AS end_sec,
    -- Stitch the turn's cues back into one block of text, in cue order.
  LISTAGG(text, ' ') WITHIN GROUP (ORDER BY seq) AS text
FROM grouped
GROUP BY session_id, filename, turn_grp
ORDER BY session_id, filename, start_seq
