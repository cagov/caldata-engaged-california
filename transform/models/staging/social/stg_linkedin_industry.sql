SELECT
    id AS industry_id,
    name AS industry_name
FROM {{ source('engaged_ca_linkedin_company_pages', 'INDUSTRY') }}
