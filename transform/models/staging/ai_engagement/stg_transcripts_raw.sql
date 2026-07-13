-- Turns each raw Zoom transcript FILE (one row, whole .vtt in one column) into
-- one row PER cue (in VTT terms a cue is a timestamped chunk of speech),
-- with numeric start/end times, a speaker, and the spoken text.
--
-- A .vtt file is made of "cues", each written as THREE lines plus a blank line:
--
--     12                                <- cue number
--     00:00:05.090 --> 00:00:20.209     <- timestamp line (start --> end)
--     Admin: Alright, so let's start.   <- the speaker: spoken text
--                                       <- blank line, then the next cue

WITH transcripts AS (SELECT * FROM {{ source('ZOOM', 'TRANSCRIPTS_RAW') }}),

-- Explode each file into one row per line of text.
lines AS (
    SELECT
        t.filename,
        --create a session id from the filename:
        REGEXP_SUBSTR(t.filename, 'GMT[0-9]{8}-[0-9]{6}') AS session_id,
        l.index AS line_no,
        l.value::string AS line
    FROM transcripts AS t,
        LATERAL SPLIT_TO_TABLE(REPLACE(t.file_content, '\r', ''), '\n') AS l
),

-- For every line, also fetch the line just BEFORE it and just AFTER it.
windowed AS (
    SELECT
        session_id,
        filename,
        line_no,
        line,
        LAG(line) OVER (PARTITION BY filename ORDER BY line_no) AS prev_line,
        LEAD(line) OVER (PARTITION BY filename ORDER BY line_no) AS next_line
    FROM lines
),

-- Keep ONLY the timestamp lines (removes blank lines), and from each line pull the pieces we need.
cues AS (
    SELECT
        session_id,
        filename,

        -- The cue number lives on prev_line.
        -- If it IS NULL (e.g. a malformed cue), COALESCE falls back to ROW_NUMBER
        -- so seq is never empty.
        COALESCE(
            TRY_TO_NUMBER(TRIM(prev_line)),
            ROW_NUMBER() OVER (PARTITION BY filename ORDER BY line_no)
        ) AS seq,
        SPLIT_PART(line, ' --> ', 1) AS start_hms,
        SPLIT_PART(line, ' --> ', 2) AS end_hms,
        next_line AS raw_text
    FROM windowed
    -- This filter isolates timestamp lines:
    WHERE line RLIKE '^[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3} --> [0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}'
)


SELECT
    session_id,
    filename,
    seq,

    -- Convert "HH:MM:SS.mmm" to total seconds since the start of the session
    SPLIT_PART(start_hms, ':', 1)::int * 3600 + SPLIT_PART(start_hms, ':', 2)::int * 60
    + SPLIT_PART(start_hms, ':', 3)::float AS start_sec,
    SPLIT_PART(end_hms, ':', 1)::int * 3600 + SPLIT_PART(end_hms, ':', 2)::int * 60
    + SPLIT_PART(end_hms, ':', 3)::float AS end_sec,

    -- Split the speaker off the front of the text. In VTT the text usually reads
    -- "Speaker Name: the words they said". If the prefix doesn't look name-like, speaker is left NULL.
    CASE
        WHEN SPLIT_PART(raw_text, ':', 1) RLIKE '[A-Za-z][A-Za-z0-9 .,''/()&-]{0,60}'
            THEN TRIM(SPLIT_PART(raw_text, ':', 1))
    END AS speaker,

    -- The text itself. If the prefix looked like a speaker, take everything AFTER
    -- the first colon. If there was no speaker prefix, keep the whole line as-is.
    CASE
        WHEN SPLIT_PART(raw_text, ':', 1) RLIKE '[A-Za-z][A-Za-z0-9 .,''/()&-]{0,60}'
            THEN TRIM(SUBSTR(raw_text, POSITION(':' IN raw_text) + 1))
        ELSE TRIM(raw_text)
    END AS text
FROM cues
