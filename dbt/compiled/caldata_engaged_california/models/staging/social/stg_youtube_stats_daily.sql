with source as (

    select * from RAW_ENGCA_PRD.YOUTUBE_ANALYTICS.CHANNEL_BASIC_A_2

),

renamed as (

    select
        _fivetran_id,
        date as stats_date,
        channel_id,
        video_id,
        live_or_on_demand,
        subscribed_status,
        country_code,
        views,
        engaged_views,
        comments,
        likes,
        dislikes,
        shares,
        watch_time_minutes,
        average_view_duration_seconds,
        average_view_duration_percentage,
        subscribers_lost,
        subscribers_gained
    from source

)

select * from renamed