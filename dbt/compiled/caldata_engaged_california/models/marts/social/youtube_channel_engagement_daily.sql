with daily as (

    select * from TRANSFORM_ENGCA_PRD.social.int_youtube_channel_daily

),

final as (

    select
        stats_date,
        channel_id,
        sum(views_total) as views_total,
        sum(engaged_views_total) as engaged_views_total,
        sum(comments_total) as comments_total,
        sum(likes_total) as likes_total,
        sum(dislikes_total) as dislikes_total,
        sum(shares_total) as shares_total,
        sum(watch_time_minutes_total) as watch_time_minutes_total
    from daily
    group by stats_date, channel_id

)

select * from final