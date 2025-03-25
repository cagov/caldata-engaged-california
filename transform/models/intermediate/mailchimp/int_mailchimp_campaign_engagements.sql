with members as (
    select * from {{ ref('stg_mailchimp_list_members') }}
),

campaigns as (
    select * from {{ ref('stg_mailchimp_campaign_recipients') }}
),

campaign_actions as (
    select * from {{ ref('stg_mailchimp_campaign_activity')}}
),

campaign_members as (
    select members.list_name,
    members.unique_email_id,
    campaigns.*
    from members inner join campaigns on members.member_id = campaigns.member_id
)

select
    campaign_members.*
    ,campaign_actions.action
    ,campaign_actions.bounce_type
    ,campaign_actions.timestamp
    ,campaign_actions.url

from campaign_members
left join campaign_actions
on campaign_members.campaign_id = campaign_actions.campaign_id
and campaign_members.member_id = campaign_actions.member_id