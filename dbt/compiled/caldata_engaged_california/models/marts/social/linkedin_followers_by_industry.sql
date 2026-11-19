SELECT
    i.industry_name,
    f.organization_urn,
    f.organic_follower_count,
    f.paid_follower_count,
    f.organic_follower_count + f.paid_follower_count AS total_follower_count
FROM TRANSFORM_ENGCA_PRD.social.stg_linkedin_follower_industry AS f
INNER JOIN TRANSFORM_ENGCA_PRD.social.stg_linkedin_industry AS i
    ON f.industry_id = i.industry_id
ORDER BY f.industry_id