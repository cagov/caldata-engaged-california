SELECT
    _fivetran_id AS share_statistic_id,
    _share_entity_urn AS post_id,
    _organization_entity_urn AS organization_urn,
    impression_count,
    click_count,
    like_count,
    comment_count,
    share_count,
    engagement
FROM {{ source('engaged_ca_linkedin_company_pages', 'SHARE_STATISTIC') }}