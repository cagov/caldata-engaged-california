with

source as (
    select * from {{ ref('stg_phase2_attendees') }}
),

upload_snapshots as (
    select
        _file as upload_file,
        min(_fivetran_synced)::date as upload_date,
        count_if(invitee_status = 'accepted') as new_registrations,
        count_if(invitee_status = 'declined') as new_declines
    from source
    group by _file
)

select
    upload_file,
    upload_date,
    new_registrations,
    new_declines,
    sum(new_registrations) over (order by upload_date, upload_file) as total_registrations,
    sum(new_declines) over (order by upload_date, upload_file) as total_declines
from upload_snapshots
order by upload_date, upload_file
