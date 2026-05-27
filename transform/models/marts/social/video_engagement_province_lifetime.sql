with stats as (

    select * from {{ ref('stg_youtube_state_stats_daily') }}

),

videos as (

    select * from {{ ref('stg_video_metadata') }}

),

joined as (

    select
        s.channel_id,
        s.video_id,
        v.snippet_title,
        coalesce(v.privacy_status, 'unknown') as privacy_status,
        s.country_code,
        s.province_code,
        s.views,
        s.engaged_views,
        s.watch_time_minutes,
        v.video_duration_seconds
    from stats as s
    left join videos as v on s.video_id = v.id
    where v.id is not null

),

final as (

    select
        channel_id,
        video_id,
        snippet_title,
        privacy_status,
        country_code,
        province_code,
        sum(views) as views_total,
        sum(engaged_views) as engaged_views_total,
        sum(watch_time_minutes) as watch_time_minutes_total,
        max(video_duration_seconds) as video_duration_seconds,
        round(sum(watch_time_minutes) * 60.0 / nullif(max(video_duration_seconds), 0) * 100, 1) as watch_time_normalized_pct
    from joined
    group by channel_id, video_id, snippet_title, privacy_status, country_code, province_code

)

select * from final
