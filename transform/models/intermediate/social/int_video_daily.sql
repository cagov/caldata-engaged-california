with stats as (

    select * from {{ ref('stg_youtube_stats_daily') }}

),

videos as (

    select * from {{ ref('stg_video_metadata') }}

),

final as (

    select
        s._fivetran_id,
        s.date,
        s.channel_id,
        s.video_id,
        v.snippet_title,
        v.snippet_published_at,
        coalesce(v.privacy_status, 'unknown') as privacy_status,
        s.country_code,
        s.views,
        s.engaged_views,
        s.comments,
        s.likes,
        s.dislikes,
        s.watch_time_minutes,
        s.average_view_duration_seconds,
        s.average_view_duration_percentage,
        v.video_duration_seconds,
        round(s.watch_time_minutes * 60.0 / nullif(v.video_duration_seconds, 0) * 100, 1) as watch_time_normalized_pct
    from stats as s
    left join videos as v on s.video_id = v.id
    where v.id is not null

)

select * from final
