with

source as (
    select * from {{ ref('stg_phase2_attendees') }}
),

upload_snapshots as (
    select
        _fivetran_synced::date as upload_date,
        count_if(invitee_status = 'accepted') as total_registrations,
        count_if(invitee_status = 'declined') as total_declines
    from source
    group by upload_date
)

select
    upload_date,
    total_registrations - coalesce(lag(total_registrations) over (order by upload_date), 0) as new_registrations,
    total_declines - coalesce(lag(total_declines) over (order by upload_date), 0) as new_declines,
    total_registrations,
    total_declines
from upload_snapshots
order by upload_date
