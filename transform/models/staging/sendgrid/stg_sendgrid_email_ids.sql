{{ config(materialized='ephemeral') }}

WITH all_emails AS (
    SELECT email FROM {{ source('SENDGRID_WEBHOOKS','EVENT') }}
    UNION
    SELECT email FROM {{ source('GOVOCAL', 'USERS') }}
),

deduplicated_emails AS (
    SELECT DISTINCT
        LOWER(TRIM(email)) AS email
    FROM all_emails
    WHERE email IS NOT NULL
)

SELECT
    {{ dbt_utils.generate_surrogate_key(['email']) }} AS email_id,
    email,
    CURRENT_TIMESTAMP AS created_at
FROM deduplicated_emails