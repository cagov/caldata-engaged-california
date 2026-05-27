with stats as (

    select * from {{ ref('stg_youtube_stats_daily') }}

),

joined as (

    select
        _fivetran_id,
        date,
        channel_id,
        video_id,
        country_code,
        engaged_views,
        comments,
        likes,
        dislikes,
        watch_time_minutes
    from stats

),

final as (

    select
        date,
        channel_id,
        country_code,
        sum(engaged_views) as engaged_views_total,
        sum(comments) as comments_total,
        sum(likes) as likes_total,
        sum(dislikes) as dislikes_total,
        sum(watch_time_minutes) as watch_time_minutes_total
    from joined
    group by date, channel_id, country_code

)

select * from final
