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

WITH transcripts AS (SELECT * FROM RAW_ENGCA_PRD.ZOOM.TRANSCRIPTS_RAW),

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
        -- If it's non-numeric, fall back to ROW_NUMBER so seq is never empty.
        COALESCE(
            TRY_TO_NUMBER(TRIM(prev_line)),
            ROW_NUMBER() OVER (PARTITION BY filename ORDER BY line_no)
        ) AS seq,

        SPLIT_PART(line, ' --> ', 1) AS start_hms,
        SPLIT_PART(line, ' --> ', 2) AS end_hms,
        next_line AS raw_text,

        -- A speaker prefix exists only if there's a colon and the part before it
        -- looks name-like. Computed once here, reused below.
        POSITION(':' IN next_line) > 0
        AND SPLIT_PART(next_line, ':', 1) RLIKE '^[A-Za-z0-9][A-Za-z0-9 .,''/()&_-]{0,60}'
            AS has_speaker
    FROM windowed
    WHERE line RLIKE '^[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3} --> [0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}'
),

parsed_cues AS (
    SELECT
        session_id,
        filename,
        seq,

        -- Convert "HH:MM:SS.mmm" to total seconds since the start of the session
        SPLIT_PART(start_hms, ':', 1)::int * 3600 + SPLIT_PART(start_hms, ':', 2)::int * 60
        + SPLIT_PART(start_hms, ':', 3)::float AS start_sec,
        SPLIT_PART(end_hms, ':', 1)::int * 3600 + SPLIT_PART(end_hms, ':', 2)::int * 60
        + SPLIT_PART(end_hms, ':', 3)::float AS end_sec,

        -- Split the speaker off the front: everything before the first colon if the
        -- prefix looked name-like, otherwise no speaker and the whole line is text.
        IFF(has_speaker, TRIM(SPLIT_PART(raw_text, ':', 1)), NULL) AS speaker,
        IFF(
            has_speaker,
            TRIM(SUBSTR(raw_text, POSITION(':' IN raw_text) + 1)),
            TRIM(raw_text)
        ) AS text
    FROM cues
),

-- Manually-reviewed per-session discussion boundaries (seconds from recording start).
transcript_times AS (
    SELECT * FROM TRANSFORM_ENGCA_PRD.ai_engagement.stg_transcript_times
)

SELECT
    c.session_id,
    c.filename,
    c.seq,
    c.start_sec,
    c.end_sec,
    c.speaker,
    c.text
FROM parsed_cues AS c
LEFT JOIN transcript_times AS w ON c.session_id = w.session_id

WHERE
    c.start_sec >= COALESCE(w.discussion_start_sec, c.start_sec)
    AND c.start_sec <= COALESCE(w.discussion_end_sec, c.start_sec)