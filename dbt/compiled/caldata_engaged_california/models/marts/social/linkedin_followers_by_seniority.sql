SELECT
    s.seniority_name,
    f.organization_urn,
    f.organic_follower_count,
    f.paid_follower_count,
    f.organic_follower_count + f.paid_follower_count AS total_follower_count
FROM TRANSFORM_ENGCA_PRD.social.stg_linkedin_follower_seniority AS f
INNER JOIN TRANSFORM_ENGCA_PRD.social.stg_linkedin_seniority AS s
    ON f.seniority_id = s.seniority_id
ORDER BY f.seniority_id