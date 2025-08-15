--This mart provides several key metrics for counting participants in the Ethelo E3 project.
with participants as (
    select * from {{ ref('stg_ethelo_e3_participants') }}

)

select
    count(distinct participant_id) as num_invited,
    count(distinct case when status = 'Joined' then participant_id end) as num_joined,
    --count(distinct case when last_invite_sent < current_date then participant_id end) as num_invited_before_today,
    --count(distinct case
    --    when
    --        status = 'Joined'
    --        and last_invite_sent < current_date then participant_id
    --end) as num_invited_before_today_and_joined,
     max(_file_upload_date) as latest_data_download
from participants
