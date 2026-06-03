SELECT
    _fivetran_id,
    seniority_id,
    _organization_entity_urn AS organization_urn,
    all_page_views,
    all_mobile_page_views,
    overview_page_views,
    people_page_views,
    jobs_page_views,
    life_at_page_views,
    insights_page_views,
    careers_page_views,
    products_page_views
FROM {{ source('engaged_ca_linkedin_company_pages', 'PAGE_STATISTIC_BY_SENIORITY') }}
