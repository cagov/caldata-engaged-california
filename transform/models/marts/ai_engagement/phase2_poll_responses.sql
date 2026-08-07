-- Unpivots the wide poll data into one row per respondent, question
-- response, so pre- and post-meeting results for the same question can be grouped and compared

with polls as (
    select * from {{ ref('stg_phase2_polls') }}
),

unpivoted as (
    select
        meeting_id,
        topic_name,
        poll_stage,
        submitted_at,
        response_seq,
        1 as question_num,
        question_1_text as question_text,
        question_1_response as response
    from polls
    where question_1_response is not null

    union all

    select
        meeting_id,
        topic_name,
        poll_stage,
        submitted_at,
        response_seq,
        2 as question_num,
        question_2_text as question_text,
        question_2_response as response
    from polls
    where question_2_response is not null

    union all

    select
        meeting_id,
        topic_name,
        poll_stage,
        submitted_at,
        response_seq,
        3 as question_num,
        question_3_text as question_text,
        question_3_response as response
    from polls
    where question_3_response is not null
)

select * from unpivoted
order by meeting_id, poll_stage, question_num, response_seq
