--create a comments mart
with comments as (
    select * from {{ ref('stg_ethelo_la_deliberation_comments') }}
)

select
    count(distinct comment_id) as num_comments,
    count(distinct posted_by_id) as num_participants_w_commments,
    max(_fivetran_synced) as max_fivetran_sync
from comments
