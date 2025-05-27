with campaigns as (

    select * from {{ ref('int_mailchimp_campaign_engagements') }}
)

select
    campaign_id,
    type as campaign_type,
    title,
    subject_line,
    archive_url,
    template_id,
    send_time,
    count(distinct unique_email_id) as unique_email_ids_sent,
    count(
        distinct
        case
            when action = 'open'
                then unique_email_id
        end
    )
        as unique_opens,
    count(
        distinct
        case
            when action = 'click'
                then unique_email_id
        end
    )
        as unique_clicks,
    count(
        distinct
        case
            when action = 'bounce'
                then unique_email_id
        end
    )
        as unique_bounces,
    max(_fivetran_synced) as max_fivetran_sync_date
from campaigns
group by all
