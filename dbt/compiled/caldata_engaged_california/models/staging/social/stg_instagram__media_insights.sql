--this model is incremental because the instagram media_insights table
--only gives results for posts created within the last 2 years



--select all the columns we might need from the media_insights table
WITH ig AS (
    SELECT
        TO_VARCHAR(id) AS media_id,
        like_count,
        comment_count,
        video_photo_impressions,
        video_photo_reach,
        video_photo_saved,
        carousel_album_engagement,
        carousel_album_impressions,
        carousel_album_reach,
        carousel_album_saved,
        story_impressions,
        story_reach,
        navigation,
        reel_reach,
        reel_saved,
        video_photo_engagement,
        story_exits,
        story_replies,
        story_taps_back,
        story_taps_forward,
        story_swipe_forward,
        reel_comments,
        reel_likes,
        reel_shares,
        reel_total_interactions,
        _fivetran_id,
        _fivetran_synced
    FROM RAW_ENGCA_PRD.ENGCA_INSTAGRAM_BUSINESS.MEDIA_INSIGHTS
)

SELECT * FROM ig

