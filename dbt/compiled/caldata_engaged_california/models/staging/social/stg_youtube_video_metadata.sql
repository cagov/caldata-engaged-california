with source as (

    select * from RAW_ENGCA_PRD.YOUTUBE_ANALYTICS.VIDEO

),

video_metadata as (

    select
        id,
        snippet_title,
        snippet_description,
        snippet_tags,
        snippet_published_at,
        snippet_channel_title,
        snippet_category_id,
        content_details_duration,
        (
            coalesce(try_to_number(regexp_substr(content_details_duration, '(\\d+)H', 1, 1, 'e', 1)), 0) * 3600
            + coalesce(try_to_number(regexp_substr(content_details_duration, '(\\d+)M', 1, 1, 'e', 1)), 0) * 60
            + coalesce(try_to_number(regexp_substr(content_details_duration, '(\\d+)S', 1, 1, 'e', 1)), 0)
        ) as video_duration_seconds,
        privacy_status,
        statistics_view_count,
        statistics_like_count,
        statistics_dislike_count,
        statistics_comment_count,
        statistics_favorite_count
    from source

)

select * from video_metadata