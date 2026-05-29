SELECT
    id AS seniority_id,
    name AS seniority_name
FROM {{ source('engaged_ca_linkedin_company_pages', 'SENIORITY') }}