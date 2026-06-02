with stats as (

    select * from {{ ref('stg_youtube_stats_daily') }}

),

videos as (

    select * from {{ ref('stg_youtube_video_metadata') }}

),

final as (

    select
        s._fivetran_id,
        s.stats_date,
        s.channel_id,
        s.video_id,
        v.snippet_title,
        v.snippet_published_at,
        v.snippet_description,
        v.snippet_tags,
        coalesce(v.privacy_status, 'unknown') as privacy_status,
        s.country_code,
        s.views,
        s.engaged_views,
        s.comments,
        s.likes,
        s.dislikes,
        s.shares,
        s.watch_time_minutes,
        s.average_view_duration_seconds,
        s.average_view_duration_percentage,
        v.video_duration_seconds
    from stats as s
    inner join videos as v on s.video_id = v.id

)

select * from final
