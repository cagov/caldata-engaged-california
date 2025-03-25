with 
lists as 
    (select
        ID as list_id,
        NAME as list_name

        from {{ source('MAILCHIMP','LIST') }} 
        where _FIVETRAN_DELETED = FALSE
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
    where list_id in (select list_id from lists)
    and _FIVETRAN_DELETED = FALSE

),

campaign_recipients as (
    select 
        member_id,
        campaign_id,
        list_id,
        _FIVETRAN_SYNCED
    from {{ source('MAILCHIMP','CAMPAIGN_RECIPIENT') }}

)

select 
    campaigns.*,
    member_id
from campaigns
inner join campaign_recipients 
on campaigns.campaign_id = campaign_recipients.campaign_id
and campaigns.list_id = campaign_recipients.list_id
