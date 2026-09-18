with bitlinks as (
    select distinct
        bitlink_id,
        title,
        long_url,
        link,
        archived,
        created_at as created_time,
        custom_bitlinks,
        tags,
        _loaded_at

    from {{ source('BITLY', 'BITLINKS_API') }}
)

select * from bitlinks
