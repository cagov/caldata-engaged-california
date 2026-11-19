with gv_users as (
    select distinct
        id as user_id,
        trim(lower(email)) as email
    from RAW_ENGCA_PRD.GOVOCAL.USERS
),

sg_emails as (
    select distinct trim(lower(email)) as email
    from RAW_ENGCA_PRD.ENGAGEDCA_SENDGRID_GOVOCAL.EVENT
),

--if sendgrid email address exists in go vocal, we'll use the GV user id.
--if it doesn't, we'll create an id from a hash.
id_join as (
    select
        sg_emails.email,
        gv_users.user_id,
        coalesce(gv_users.user_id, md5(cast(coalesce(cast(sg_emails.email as TEXT), '_dbt_utils_surrogate_key_null_') as TEXT))) as email_user_id
    from sg_emails
    left join gv_users
        on sg_emails.email = gv_users.email
)

select * from id_join