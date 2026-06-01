SELECT
    id AS post_id,
    first_published_at AS post_published_at,
    created_time AS post_created_at,
    last_modified_time AS post_last_modified_at,
    commentary AS post_commentary,
    visibility AS post_visibility,
    lifecycle_state AS post_lifecycle_state,
    author AS post_author_urn,
    container_entity AS post_organization_urn
FROM {{ source('engaged_ca_linkedin_company_pages', 'UGC_POST_HISTORY') }}
