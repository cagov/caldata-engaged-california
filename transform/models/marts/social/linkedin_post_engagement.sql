SELECT
    p.post_id,
    p.post_published_at AS post_date,
    p.post_commentary,
    p.post_visibility,
    p.post_lifecycle_state,
    p.post_author_urn,
    s.impression_count,
    s.click_count,
    s.like_count,
    s.comment_count,
    s.share_count,
    s.engagement
FROM {{ ref('stg_linkedin_post_history') }} p
LEFT JOIN {{ ref('stg_linkedin_share_stats') }} s
    ON s.post_id = p.post_id