with

email_campaign_deliveries as (select * from RAW_ENGCA_PRD.GOVOCAL.EMAIL_CAMPAIGN_DELIVERIES)

select
    id as email_campaign_delivery_id,
    email_campaign_id,
    user_id,
    delivery_status,
    sent_at::timestamp_ltz as sent_at,
    created_at::timestamp_ltz as created_at,
    updated_at::timestamp_ltz as updated_at,
    _load_date,
    _loaded_at
from email_campaign_deliveries