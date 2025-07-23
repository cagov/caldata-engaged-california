--create a participants mart
with participants as (
    select * from {{ ref('stg_ethelo_la_deliberation_participants') }}

)

select
    count(distinct participant_id) as num_invited,
    count(distinct case when status = 'Joined' then participant_id end) as num_joined,
    count(distinct case when last_invite_sent < current_date then participant_id end) as num_invited_before_today,
    count(distinct case
        when
            status = 'Joined'
            and last_invite_sent < current_date then participant_id
    end) as num_invited_before_today_and_joined,
    max(_fivetran_synced) as max_fivetran_sync
from participants
