SELECT
    s.seniority_name,
    f.organization_urn,
    f.organic_follower_count,
    f.paid_follower_count,
    f.organic_follower_count + f.paid_follower_count AS total_follower_count
FROM {{ ref('stg_linkedin_follower_seniority') }} f
INNER JOIN {{ ref('stg_linkedin_seniority') }} s
    ON s.seniority_id = f.seniority_id
ORDER BY f.seniority_id
