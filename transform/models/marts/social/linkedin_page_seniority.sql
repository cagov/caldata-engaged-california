SELECT
    s.seniority_name,
    p.organization_urn,
    p.all_page_views,
    p.all_mobile_page_views,
    p.overview_page_views,
    p.people_page_views,
    p.jobs_page_views,
    p.life_at_page_views,
    p.insights_page_views,
    p.careers_page_views,
    p.products_page_views
FROM {{ ref('stg_linkedin_page_seniority') }} p
LEFT JOIN {{ ref('stg_linkedin_seniority') }} s
    ON s.seniority_id = p.seniority_id