-- this table combines comments with survey responses
with comments as (
    select
        comment_id,
        reply_to_id,
        posted_by_id as participant_id,
        comment_content as content,
        target as question,
        posted_on,
        like_count,
        _file_upload_date
    from {{ ref('stg_ethelo_e3_comments') }}
),

survey as (
    select
        null as comment_id,
        null as reply_to_id,
        participant_id,
        answer as content,
        question,
        response_date as posted_on,
        null as like_count,
        _file_upload_date
    from {{ ref('stg_ethelo_e3_survey') }}
    where question = 'Opening question - What makes you proud about your role in public service?'
)

select *
from comments
union distinct
select * from survey
