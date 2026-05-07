-- mart_facebook_pages__post_engagement.sql
-- Final mart: one row per Facebook Page post with all engagement KPIs.

-- Key metrics:
--   engagement_rate_pct    = (reactions + clicks) / impressions × 100
--   click_through_rate_pct = clicks / impressions × 100
--   reaction_rate_pct      = reactions / impressions × 100
--   paid_impression_share_pct = impressions_paid / impressions_total × 100
--   engagement_tier        = 'high' / 'medium' / 'low' / 'unknown'


with final as (

    select * from {{ ref('int_instagram_posts_join') }}

)

select * from final
