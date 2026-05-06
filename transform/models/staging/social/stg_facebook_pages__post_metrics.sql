with source as (

    select * from {{ source('FACEBOOK_PAGES', 'LIFETIME_POST_METRICS_TOTAL') }}

),

renamed as (

    select
        -- ── Keys ───────────────────────────────────────────────────────────
        post_id,
        cast(date as date)                                  as metrics_date,

        -- ── Clicks & engagement ────────────────────────────────────────────
        coalesce(post_clicks, 0)                            as clicks_total,
        coalesce(post_media_view,0)    as media_views_total,

        -- ── Reactions by type ──────────────────────────────────────────────
        coalesce(post_reactions_like_total, 0)              as reactions_like,
        coalesce(post_reactions_love_total, 0)              as reactions_love,
        coalesce(post_reactions_haha_total, 0)              as reactions_haha,
        coalesce(post_reactions_wow_total, 0)               as reactions_wow,
        coalesce(post_reactions_sorry_total, 0)             as reactions_sorry,
        coalesce(post_reactions_anger_total, 0)             as reactions_anger,

        -- Total reactions = sum of all reaction types
        coalesce(post_reactions_like_total, 0)
            + coalesce(post_reactions_love_total, 0)
            + coalesce(post_reactions_haha_total, 0)
            + coalesce(post_reactions_wow_total, 0)
            + coalesce(post_reactions_sorry_total, 0)
            + coalesce(post_reactions_anger_total, 0)       as reactions_total,

        -- there are many more video metrics available in the source table; we can add more later if needed
        post_video_views,
        post_video_view_time,
        post_video_views_organic,
        post_video_views_paid,
        post_video_avg_time_watched,
        post_video_length,
        post_video_complete_views_organic,
        post_video_complete_views_paid,
        _fivetran_synced

    from source

)

select * from renamed
