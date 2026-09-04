with stats as (

    select * from TRANSFORM_ENGCA_PRD.social.stg_youtube_stats_daily

),

joined as (

    select
        _fivetran_id,
        stats_date,
        channel_id,
        video_id,
        country_code,
        views,
        engaged_views,
        comments,
        likes,
        dislikes,
        shares,
        watch_time_minutes
    from stats

),

final as (

    select
        stats_date,
        channel_id,
        country_code,
        sum(views) as views_total,
        sum(engaged_views) as engaged_views_total,
        sum(comments) as comments_total,
        sum(likes) as likes_total,
        sum(dislikes) as dislikes_total,
        sum(shares) as shares_total,
        sum(watch_time_minutes) as watch_time_minutes_total
    from joined
    group by stats_date, channel_id, country_code

)

select * from final