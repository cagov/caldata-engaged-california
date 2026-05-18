with qr_scan_metrics as (
    select distinct
        qr_code_id,
        total_scans,
        _loaded_at
    from {{ source('BITLY', 'QR_CODE_SCAN_METRICS') }}

    --Only keep the most recent scan metrics for each QR code
    qualify row_number() over (partition by qr_code_id order by _loaded_at desc) = 1
)

select * from qr_scan_metrics
