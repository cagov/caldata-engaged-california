with link_metrics as (
    select distinct
        bitlink_id,
        total_clicks,
        _loaded_at
    from RAW_ENGCA_PRD.BITLY.BITLINK_CLICK_METRICS_API

    --Only keep the most recent click metrics for each bitlink
    qualify row_number() over (partition by bitlink_id order by _loaded_at desc) = 1
)

select * from link_metrics