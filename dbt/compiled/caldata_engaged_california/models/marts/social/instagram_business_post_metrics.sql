with final as (

    select
        permalink,
        media_type,
        media_product_type,
        media_url,
        caption,
        created_time,
        media_id,
        like_count,
        comment_count,
        video_photo_reach,
        video_photo_saved,
        carousel_album_engagement,
        carousel_album_reach,
        reel_reach,
        video_photo_engagement,
        reel_comments,
        reel_likes,
        reel_shares,
        reel_total_interactions,
        _fivetran_synced
    from TRANSFORM_ENGCA_PRD.social.int_instagram_posts_join

)

select * from final