-- Fuzzy matching attendees to speakers

WITH

attendees AS (
    SELECT
        invitee_first_name,
        invitee_last_name,
        coalesce(invitee_first_name, '') || ' ' || coalesce(invitee_last_name, '') AS invitee_match_name,
        invitee_email,
        try_to_date(start_date_time, 'MM/DD/YY') AS attendee_date,
        actual_status
    FROM TRANSFORM_ENGCA_PRD.ai_engagement.stg_attendance_tracker
    WHERE actual_status = 'Attended' OR actual_status = 'Staff'
),

speakers AS (
    SELECT DISTINCT
        speaker,
        speaker_id,
        session_id
    FROM TRANSFORM_ENGCA_PRD.ai_engagement.stg_zoom_transcript_speakers
    WHERE speaker IS NOT null
),

transcript_dates AS (
    SELECT *
    FROM TRANSFORM_ENGCA_PRD.ai_engagement.stg_transcript_times
),

invitee_gv_ids AS (
    SELECT
        survey_respondent_id,
        invitee_email,
        attendee_status
    FROM TRANSFORM_ENGCA_PRD.ai_engagement.int_ai_engagement_phase2_invitee_status
),

cleaned_speakers AS (
    SELECT
        s.speaker,
        s.speaker_id,
        s.session_id,
        to_date(td.session_date) AS session_date,
        lower(
            trim(
                regexp_replace(
                    regexp_replace(
                        regexp_replace(
                            -- remove parenthesis and anything inside parenthesis
                            regexp_replace(s.speaker, '\\(.*?\\)', ''),
                            ',\\s*.*$', '' -- remove a comma and anything after it
                        ),
                        -- remove any of these, case insensitive
                        'facilitator|engagedca|engaged california|engaged ca|she/hers|she/her|he/his|he/him',
                        '',
                        1,
                        0,
                        'i'
                    ),
                    '[._-]', ' '  -- remove periods, underscores, and hyphens
                )
            )
        ) AS speaker_match_name,
        split_part(speaker_match_name, ' ', 1) AS speaker_first_name,
        substr(speaker_match_name, position(' ' IN speaker_match_name) + 1) AS speaker_last_name
    FROM speakers AS s
    INNER JOIN transcript_dates AS td
        ON (s.session_id = td.session_id)
),

speaker_matches AS (
    SELECT
        s.session_date,
        s.speaker_match_name,
        a.invitee_match_name,
        CASE
            WHEN s.speaker_match_name = a.invitee_match_name
                THEN 100
            WHEN s.speaker_first_name = a.invitee_first_name
                THEN 99
            WHEN s.speaker_last_name = a.invitee_last_name
                THEN 99
            ELSE zeroifnull(
                greatest(
                    jarowinkler_similarity(s.speaker_match_name, a.invitee_match_name),
                    jarowinkler_similarity(s.speaker_first_name, a.invitee_first_name),
                    jarowinkler_similarity(s.speaker_last_name, a.invitee_last_name)
                )
            )
        END AS match_score,
        s.speaker,
        s.speaker_first_name,
        s.speaker_last_name,
        s.speaker_id,
        s.session_id,
        a.invitee_first_name,
        a.invitee_last_name,
        a.invitee_email
    FROM cleaned_speakers AS s
    LEFT JOIN attendees AS a
        ON (s.session_date = a.attendee_date)
    QUALIFY row_number() OVER (
        PARTITION BY s.speaker_id
        ORDER BY match_score DESC, a.invitee_match_name ASC
    ) = 1
),

speaker_gv_ids AS (
    SELECT
        a.attendee_date AS session_date,
        a.invitee_match_name,
        CASE
            WHEN sm.speaker_id = '47f97458a9cbf2a285a628b26dd97824' THEN 'No GV account'
            WHEN i.attendee_status = 'staff' OR i.invitee_email IS null THEN 'staff'
            ELSE i.survey_respondent_id
        END AS survey_respondent_id,
        sm.speaker,
        sm.speaker_match_name,
        sm.match_score AS name_match_score,
        i.attendee_status,
        sm.speaker_id,
        sm.session_id
    FROM attendees AS a
    LEFT JOIN speaker_matches AS sm
        ON
            a.invitee_match_name = sm.invitee_match_name
            AND a.attendee_date = sm.session_date
    LEFT JOIN invitee_gv_ids AS i
        ON a.invitee_email = i.invitee_email
)

SELECT *
FROM speaker_gv_ids
ORDER BY session_date, speaker