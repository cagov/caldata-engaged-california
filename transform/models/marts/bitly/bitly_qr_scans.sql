with scan_metrics as (select * from RAW_ENGCA_PRD.BITLY.QR_CODE_SCAN_METRICS),
qr_codes as (select * from RAW_ENGCA_PRD.BITLY.QR_CODE_IDS)


select
    qr_codes.qr_code_id,
    qr_codes.title,
    qr_codes.qr_code_type,
    qr_codes.long_url,
    qr_codes.bitlink_id,
    qr_codes.created_time,
    qr_codes.updated_time,
    scan_metrics.total_scans,
    greatest(qr_codes._loaded_at, scan_metrics._loaded_at) as _loaded_at

from qr_codes 
left join 
scan_metrics 
on qr_codes.qr_code_id = scan_metrics.qr_code_id