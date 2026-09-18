--create a participants mart
with participants as (
    select * from ANALYTICS_ENGCA_PRD.ethelo.participants

)

select
    count(distinct participant_id) as num_invited,
    count(distinct case when status = 'Joined' then participant_id end) as num_joined,
    max(_fivetran_synced) as max_fivetran_sync
from participants