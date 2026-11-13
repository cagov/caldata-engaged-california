SELECT
    p.post_id,
    p.post_published_at,
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
FROM TRANSFORM_ENGCA_PRD.social.stg_linkedin_post_history AS p
LEFT JOIN TRANSFORM_ENGCA_PRD.social.stg_linkedin_share_stats AS s
    ON p.post_id = s.post_id