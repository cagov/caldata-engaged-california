WITH ig AS (
    SELECT
        TO_VARCHAR(id) AS media_id,
        permalink,
        media_type,
        media_product_type,
        media_url,
        caption,
        TO_VARCHAR(carousel_album_id) AS carousel_album_id,
        is_comment_enabled,
        is_story,
        TO_TIMESTAMP(created_time) AS created_time,
        _fivetran_synced
    FROM {{ source('INSTAGRAM_BUSINESS', 'MEDIA_HISTORY') }}
)

SELECT *
FROM ig
