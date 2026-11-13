WITH

attendees AS (
    SELECT
        trim(lower(invitee_first_name)) AS invitee_first_name,
        trim(lower(invitee_last_name)) AS invitee_last_name,
        invitee_email,
        md5(lower(trim(invitee_email))) AS invitee_email_hash,
        trim(lower(invitee_email)) LIKE '%@innovation.ca.gov' AS has_internal_email,
        actual_status,
        start_date_time,
        end_date_time,
        session_number
    FROM RAW_ENGCA_PRD.ZOOM.ATTENDANCE_TRACKER
)

SELECT * FROM attendees