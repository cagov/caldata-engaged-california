with qr_codes as (
    select distinct
        qr_code_id,
        title,
        qr_code_type,
        long_url,
        bitlink_id,
        created as created_time,
        updated as updated_time,
        _loaded_at
    from {{ source('BITLY', 'QR_CODE_IDS') }}
)

select * from qr_codes
