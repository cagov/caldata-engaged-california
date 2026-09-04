WITH ig AS (
    SELECT
        TO_VARCHAR(media_id) AS media_id,
        TO_VARCHAR(id) AS comment_id,
        TO_VARCHAR(parent_id) AS parent_comment_id,
        TO_VARCHAR(owner_id) AS comment_user_id,
        text,
        hidden,
        like_count,
        created_time,
        _fivetran_synced
    FROM RAW_ENGCA_PRD.ENGCA_INSTAGRAM_BUSINESS.MEDIA_COMMENT
)

SELECT *
FROM ig