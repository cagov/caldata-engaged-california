with source as (

    select * from RAW_ENGCA_PRD.FACEBOOK_PAGES_ENGCA.POST_HISTORY

),

current_posts as (
    -- Keep only the active (latest) version of each post
    select * from source
    where
        is_hidden = FALSE
        and is_expired = FALSE
        and is_published = TRUE

),

renamed as (
    select
        id as post_id,
        page_id,
        message as post_message,
        status_type as post_type,
        permalink_url,
        full_picture as picture_url,
        share_count,
        cast(created_time as timestamp) as created_at,
        cast(updated_time as timestamp) as updated_at,
        is_expired,
        _fivetran_synced

    from current_posts

)

select * from renamed