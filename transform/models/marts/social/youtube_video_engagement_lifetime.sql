with daily as (

    select * from {{ ref('int_youtube_video_daily') }}

),

final as (

    select
        channel_id,
        video_id,
        snippet_title,
        snippet_published_at,
        snippet_description,
        snippet_tags,
        privacy_status,
        sum(views) as views_total,
        sum(engaged_views) as engaged_views_total,
        sum(comments) as comments_total,
        greatest(sum(likes), 0) as likes_total,
        sum(dislikes) as dislikes_total,
        sum(shares) as shares_total,
        sum(watch_time_minutes) as watch_time_minutes_total,
        max(video_duration_seconds) as video_duration_seconds,
        round(sum(watch_time_minutes) * 60.0 / nullif(sum(views), 0) / nullif(max(video_duration_seconds), 0) * 100, 1)
            as avg_completion_pct
    from daily
    where privacy_status != 'unlisted'
    group by
        channel_id, video_id, snippet_title, snippet_published_at, snippet_description, snippet_tags, privacy_status

)

select * from final
