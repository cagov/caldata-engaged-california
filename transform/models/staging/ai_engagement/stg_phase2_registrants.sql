with

phase_2_registrants as (select * from {{ source('FILE_DOWNLOADS', 'PH_2_ATTENDEES') }})

select
    event_type_name as event_name,
    invitee_email,
    invitee_first_name,
    invitee_last_name,
    invitee_status,
    marked_as_no_show,
    start_date_time,
    end_date_time,
    event_created_date_time,
    _file,
    _fivetran_synced
from phase_2_registrants
where
    lower(event_name) not like '%test%'
