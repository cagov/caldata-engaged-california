with final as (

    select
        stats_date,
        channel_id,
        video_id,
        snippet_title,
        snippet_published_at,
        snippet_description,
        snippet_tags,
        privacy_status,
        sum(views) as views,
        sum(engaged_views) as engaged_views,
        sum(comments) as comments,
        sum(likes) as likes,
        sum(dislikes) as dislikes,
        sum(shares) as shares,
        sum(watch_time_minutes) as watch_time_minutes,
        max(video_duration_seconds) as video_duration_seconds,
        round(sum(watch_time_minutes) * 60.0 / nullif(sum(views), 0) / nullif(max(video_duration_seconds), 0) * 100, 1)
            as avg_completion_pct
    from {{ ref('int_youtube_video_daily') }}
    where privacy_status != 'unlisted'
    group by
        stats_date,
        channel_id,
        video_id,
        snippet_title,
        snippet_published_at,
        snippet_description,
        snippet_tags,
        privacy_status

)

select * from final
