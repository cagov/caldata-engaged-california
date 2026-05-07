WITH ig AS (
    SELECT
        ig_id AS instagram_account_id,
        followers_count AS snapshot_followers_count,
        _fivetran_synced,
        TO_DATE(_fivetran_synced) AS last_updated_date
    FROM {{ source('INSTAGRAM_BUSINESS', 'USER_HISTORY') }}
),

max_timestamp AS (
    SELECT
        instagram_account_id,
        MAX_BY(_fivetran_synced, last_updated_date) AS max_time,
        last_updated_date
    FROM ig
    GROUP BY ALL
)

SELECT
    ig.instagram_account_id,
    ig.snapshot_followers_count,
    ig.last_updated_date
FROM ig
INNER JOIN max_timestamp
    ON
        ig.last_updated_date = max_timestamp.last_updated_date
        AND ig._fivetran_synced = max_timestamp.max_time
ORDER BY ig.last_updated_date
