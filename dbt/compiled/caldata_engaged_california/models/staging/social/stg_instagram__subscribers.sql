WITH ig AS (
    SELECT
        ig_id AS instagram_account_id,
        followers_count AS snapshot_followers_count,
        _fivetran_synced,
        TO_DATE(_fivetran_synced) AS last_updated_date
    FROM RAW_ENGCA_PRD.ENGCA_INSTAGRAM_BUSINESS.USER_HISTORY
)

SELECT
    instagram_account_id,
    snapshot_followers_count,
    last_updated_date
FROM ig
QUALIFY MAX_BY(_fivetran_synced, last_updated_date) OVER (PARTITION BY instagram_account_id) = _fivetran_synced
ORDER BY last_updated_date