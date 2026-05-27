with source as (

    select * from {{ source('YOUTUBE_ANALYTICS', 'CHANNEL_PROVINCE_A_2') }}

),

renamed as (

    select
        _fivetran_id,
        date,
        channel_id,
        video_id,
        live_or_on_demand,
        subscribed_status,
        country_code,
        province_code,
        views,
        watch_time_minutes,
        average_view_duration_seconds,
        average_view_duration_percentage,
        engaged_views
    from source

)

select * from renamed
