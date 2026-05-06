-- mart_facebook_pages__post_engagement.sql
-- Final mart: one row per Facebook Page post with all engagement KPIs.

-- Key metrics:
--   engagement_rate_pct    = (reactions + clicks) / impressions × 100
--   click_through_rate_pct = clicks / impressions × 100
--   reaction_rate_pct      = reactions / impressions × 100
--   paid_impression_share_pct = impressions_paid / impressions_total × 100
--   engagement_tier        = 'high' / 'medium' / 'low' / 'unknown'


 with enriched as (

    select * from {{ ref('int_facebook_pages__post_analytics') }}

),

final as (

    select
        post_id,
        page_id,
        post_type,
        post_message,
        permalink_url,
        picture_url,
        created_at,
        updated_at,
        post_views_total,
        clicks_total,
        reactions_total,
        reactions_like,
        reactions_love,
        reactions_haha,
        reactions_wow,
        reactions_sorry,
        reactions_anger,
        post_video_views,
        post_video_view_time,
        post_video_avg_time_watched,
        post_video_length,
        post_video_complete_views_organic,
        post_video_complete_views_paid,
        total_engagements,
        engagement_rate_pct,
        click_through_rate_pct,
        reaction_rate_pct,
        post_type in ('added_video', 'shared_story')        as is_video_post,
        post_type = 'added_photos'                          as is_photo_post,
        post_type = 'mobile_status_update'                  as is_status_post,
        post_type = 'wall_post'                             as is_link_post

    from enriched

)

select * from final