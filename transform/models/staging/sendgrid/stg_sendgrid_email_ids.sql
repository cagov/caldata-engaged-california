with gv_users as (
    select distinct
        id as user_id,
        trim(lower(email)) as email
    from {{ source('GOVOCAL', 'USERS') }}
),

sg_emails as (
    select distinct trim(lower(email)) as email
    from {{ source('SENDGRID_WEBHOOKS','EVENT') }}
),

--if sendgrid email address exists in go vocal, we'll use the GV user id.
--if it doesn't, we'll create an id from a hash.
id_join as (
    select
        sg_emails.email,
        gv_users.user_id,
        coalesce(gv_users.user_id, {{ dbt_utils.generate_surrogate_key(['sg_emails.email']) }}) as email_user_id
    from sg_emails
    left join gv_users
        on sg_emails.email = gv_users.email
)

select * from id_join
