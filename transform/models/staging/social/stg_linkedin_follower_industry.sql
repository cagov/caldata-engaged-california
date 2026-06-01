SELECT
    _fivetran_id,
    _organization_entity_urn AS organization_urn,
    industry_id,
    follower_counts_organic_follower_count AS organic_follower_count,
    follower_counts_paid_follower_count AS paid_follower_count,
    _fivetran_synced AS fivetran_synced
FROM {{ source('engaged_ca_linkedin_company_pages', 'FOLLOWERS_BY_INDUSTRY') }}
