WITH

attendees AS (
    SELECT
        trim(lower(invitee_first_name)) AS invitee_first_name,
        trim(lower(invitee_last_name)) AS invitee_last_name,
        invitee_email,
        start_date_time,
        actual_status,
        try_to_date(start_date_time, 'MM/DD/YY') AS attendee_date,
        session_number
    FROM {{ source('ZOOM', 'ATTENDANCE_TRACKER') }}
)

SELECT * FROM attendees
