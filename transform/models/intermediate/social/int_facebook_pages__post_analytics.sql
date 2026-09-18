-- Joins staged posts with their lifetime metrics and derives all KPIs needed for the mart layer.

with posts as (

    select * from {{ ref('stg_facebook_pages__posts') }}

),

metrics as (

    select * from {{ ref('stg_facebook_pages__post_metrics') }}

),

joined as (

    select
        p.post_id,
        p.page_id,
        p.post_message,
        p.post_type,
        p.permalink_url,
        p.picture_url,
        p.is_expired,
        p.created_at,
        p.updated_at,
        coalesce(m.media_views_total, 0) as post_views_total,
        coalesce(m.clicks_total, 0) as clicks_total,
        coalesce(p.share_count, 0) as share_count,
        coalesce(m.reactions_total, 0) as reactions_total,
        coalesce(m.reactions_like, 0) as reactions_like,
        coalesce(m.reactions_love, 0) as reactions_love,
        coalesce(m.reactions_haha, 0) as reactions_haha,
        coalesce(m.reactions_wow, 0) as reactions_wow,
        coalesce(m.reactions_sorry, 0) as reactions_sorry,
        coalesce(m.reactions_anger, 0) as reactions_anger,
        m.post_video_views,
        m.post_video_view_time,
        m.post_video_avg_time_watched,
        m.post_video_length,
        m.post_video_complete_views_organic,
        m.post_video_complete_views_paid,

        -- Total engagement = all reactions + clicks
        coalesce(m.reactions_total, 0)
        + coalesce(m.clicks_total, 0)
        + coalesce(p.share_count, 0)
            as total_engagements,

        -- Engagement rate: (reactions + clicks) / impressions × 100
        case
            when coalesce(m.media_views_total, 0) = 0 then null
            else round(
                (coalesce(m.reactions_total, 0) + coalesce(m.clicks_total, 0) + coalesce(p.share_count, 0))
                / nullif(m.media_views_total, 0)::numeric * 100, 4
            )
        end as engagement_rate_pct,

        -- CTR: clicks / impressions × 100
        case
            when coalesce(m.media_views_total, 0) = 0 then null
            else round(
                coalesce(m.clicks_total, 0)
                / nullif(m.media_views_total, 0)::numeric * 100, 4
            )
        end as click_through_rate_pct,

        -- Reaction rate: reactions / impressions × 100
        case
            when coalesce(m.media_views_total, 0) = 0 then null
            else round(
                coalesce(m.reactions_total, 0)
                / nullif(m.media_views_total, 0)::numeric * 100, 4
            )
        end as reaction_rate_pct


    from posts as p
    left join metrics as m
        on p.post_id = m.post_id

)

select * from joined
