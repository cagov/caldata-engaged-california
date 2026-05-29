with daily as (

    select * from {{ ref('int_youtube_channel_daily') }}

),

final as (

    select
        channel_id,
        sum(views_total) as views_total,
        sum(engaged_views_total) as engaged_views_total,
        sum(comments_total) as comments_total,
        greatest(sum(likes_total), 0) as likes_total,
        sum(dislikes_total) as dislikes_total,
        sum(shares_total) as shares_total,
        sum(watch_time_minutes_total) as watch_time_minutes_total,
        avg(watch_time_minutes_total) as watch_time_minutes_avg
    from daily
    group by channel_id

)

select * from final
