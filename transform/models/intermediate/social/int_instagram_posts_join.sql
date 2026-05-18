-- this model combines the media_history table which has all instagram
-- posts and their metadata with the media_insights table which has metrics
-- per post

with ig as (select * from {{ ref("stg_instagram__media_insights") }})
,

--the media insights table has multiple rows per media/post id (every time a metrics value changes)
--so we want to pick the most recent numbers per id
ig_media_insights as (
    select *
    from ig
    qualify MAX(_fivetran_synced) over (partition by media_id) = _fivetran_synced
),

--we want to be able to show metadata about posts next to the media insights metrics
ig_media_history as (
    select *
    from {{ ref('stg_instagram__media_history') }}
),

--- join media history and media insights
ig_media_join as (
    select
        a.permalink,
        a.media_type,
        a.media_product_type,
        a.media_url,
        a.caption,
        TO_VARCHAR(a.carousel_album_id) as carousel_album_id,
        a.is_comment_enabled,
        a.is_story,
        TO_DATE(a.created_time) as created_time,
        b.*
    from ig_media_history as a
    inner join ig_media_insights as b on a.media_id = b.media_id
)

select * from ig_media_join
