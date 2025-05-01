with
lists as (
    select * from {{ ref('stg_mailchimp_list_filter') }}
),

campaigns as (
    select
        campaign.id as campaign_id,
        campaign.type,
        campaign.create_time,
        campaign.archive_url,
        campaign.status,
        campaign.send_time,
        campaign.content_type,
        campaign.list_id,
        campaign.title,
        campaign.subject_line,
        campaign.from_name,
        campaign.template_id
    from {{ source('MAILCHIMP','CAMPAIGN') }} as campaign
    where
        campaign.list_id in (select lists.list_id from lists)
        and campaign._fivetran_deleted = FALSE

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
