with

source as (
    select * from {{ ref('stg_phase2_registrants') }}
),

unmatched_participants as (
    select
        invitee_email,
        max(staff_or_moderator) as staff_or_moderator
    from {{ ref('stg_zoom_unmatched_participants') }}
    group by invitee_email
),

non_staff as (
    select s.*
    from source as s
    left join unmatched_participants as um
        on lower(trim(s.invitee_email)) = lower(trim(um.invitee_email))
    where
        um.staff_or_moderator is null
        or um.staff_or_moderator = false
),

upload_snapshots as (
    select
        _fivetran_synced::date as upload_date,
        count_if(invitee_status = 'accepted') as total_registrations,
        count_if(invitee_status = 'declined') as total_declines
    from non_staff
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
