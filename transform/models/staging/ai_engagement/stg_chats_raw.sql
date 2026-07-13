-- This model turns each raw Zoom chat file into
-- one row PER chat MESSAGE, with a numeric timestamp, speaker, and the full text of the chat.

WITH chats as (select * from {{ source('ZOOM', 'CHATS_RAW') }}),

-- Explode each file into one row per line of chat, and tag each line with its session.
lines AS (
  SELECT
    --create a session id from the filename:
    REGEXP_SUBSTR(filename, 'GMT[0-9]{8}-[0-9]{6}') AS session_id,
    l.index         AS line_no,
    l.value::string AS line
  FROM chats,
       LATERAL SPLIT_TO_TABLE(REPLACE(file_content, '\r', ''), '\n') l
  WHERE l.value RLIKE '^[0-9]{2}:[0-9]{2}:[0-9]{2}' || CHAR(9) || '.*'  --remove any blank lines
)

SELECT
  session_id,
  line_no,

  --normalize timestamp into number of seconds since the start of the session:
  SPLIT_PART(SPLIT_PART(line, CHAR(9), 1), ':', 1)::int*3600
    + SPLIT_PART(SPLIT_PART(line, CHAR(9), 1), ':', 2)::int*60
    + SPLIT_PART(SPLIT_PART(line, CHAR(9), 1), ':', 3)::int AS start_sec,

  -- extract speaker and text from the line:
  RTRIM(SPLIT_PART(line, CHAR(9), 2), ':')                  AS speaker,
  SPLIT_PART(line, CHAR(9), 3)                              AS text
FROM lines