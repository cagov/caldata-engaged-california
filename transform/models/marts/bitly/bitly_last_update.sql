with
links as (
    select * from {{ ref('stg_bitly_links') }}
)

select min(_fivetran_synced) as last_update
from links
