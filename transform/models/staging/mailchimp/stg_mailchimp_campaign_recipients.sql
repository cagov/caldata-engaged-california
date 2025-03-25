with
lists as (
    select
        id as list_id,
        name as list_name

    from {{ source('MAILCHIMP','LIST') }}
    where
        _fivetran_deleted = FALSE
        and list_name = 'Engaged California' --this is the list name for the Engaged CA audience in Mailchimp
),

campaigns as (
    select
        id as campaign_id,
        type,
        create_time,
        archive_url,
        status,
        send_time,
        content_type,
        list_id,
        title,
        subject_line,
        from_name,
        template_id
    from {{ source('MAILCHIMP','CAMPAIGN') }}
    where
        list_id in (select list_id from lists)
        and _fivetran_deleted = FALSE

),

campaign_recipients as (
    select
        member_id,
        campaign_id,
        list_id,
        _fivetran_synced
    from {{ source('MAILCHIMP','CAMPAIGN_RECIPIENT') }}

)

select
    campaigns.*,
    campaign_recipients.member_id
from campaigns
inner join campaign_recipients
    on
        campaigns.campaign_id = campaign_recipients.campaign_id
        and campaigns.list_id = campaign_recipients.list_id
