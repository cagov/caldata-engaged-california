SELECT
    i.industry_name,
    f.organization_urn,
    f.organic_follower_count,
    f.paid_follower_count,
    f.organic_follower_count + f.paid_follower_count AS total_follower_count
FROM {{ ref('stg_linkedin_follower_industry') }} f
INNER JOIN {{ ref('stg_linkedin_industry') }} i
    ON i.industry_id = f.industry_id
ORDER BY f.industry_id
