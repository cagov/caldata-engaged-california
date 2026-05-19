--This mart provides several key metrics for counting participants in the Ethelo E3 project.
with participants as (
    select * from TRANSFORM_ENGCA_PRD.ethelo_e3.stg_ethelo_e3_participants
),

tz_conversion as (
    select
        *,
        cast(convert_timezone('America/Los_Angeles', last_invite_sent) as date) as last_invite_sent_date
    from participants
)

select
    count(distinct participant_id) as num_invited,
    count(distinct case when status = 'Joined' then participant_id end) as num_joined,
    count(distinct case when last_invite_sent_date < current_date then participant_id end) as num_invited_before_today,
    count(distinct case
        when
            status = 'Joined'
            and last_invite_sent_date < current_date
            then participant_id
    end) as num_invited_before_today_and_joined,
    max(_file_upload_date) as latest_data_download
from tz_conversion