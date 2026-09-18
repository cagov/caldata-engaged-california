with

email_campaigns as (select * from {{ source('GOVOCAL', 'EMAIL_CAMPAIGNS') }})

select
    id as email_campaign_id,
    sender,
    reply_to,
    subject,
    body,
    try_parse_json(subject_multiloc) as subject_multiloc,
    try_parse_json(body_multiloc) as body_multiloc,
    deliveries_count,
    created_at::timestamp_ltz as created_at,
    updated_at::timestamp_ltz as updated_at,
    _load_date,
    _loaded_at
from email_campaigns
