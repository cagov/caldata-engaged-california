with daily as (

    select * from {{ ref('int_video_daily') }}

),

final as (

    select
        channel_id,
        video_id,
        snippet_title,
        privacy_status,
        country_code,
        sum(views) as views_total,
        sum(engaged_views) as engaged_views_total,
        sum(comments) as comments_total,
        sum(likes) as likes_total,
        sum(dislikes) as dislikes_total,
        sum(watch_time_minutes) as watch_time_minutes_total,
        max(video_duration_seconds) as video_duration_seconds,
        round(sum(watch_time_minutes) * 60.0 / nullif(max(video_duration_seconds), 0) * 100, 1) as watch_time_normalized_pct
    from daily
    group by channel_id, video_id, snippet_title, privacy_status, country_code

)

select * from final
