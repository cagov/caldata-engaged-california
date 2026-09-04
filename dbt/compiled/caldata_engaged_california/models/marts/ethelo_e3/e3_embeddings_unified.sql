-- noqa: disable=LT05
-- Unified embedding table containing both raw main ideas and processed problem/solution pairs
-- Each row represents one text item with consistent embeddings for similarity analysis

with main_ideas as (
    select
        c.posted_by_id as participant_id,
        c.comment_id,
        'Raw Main Idea' as content_type,
        concat(
            'This is a main idea submitted by a California state employee for improving government efficiency.',
            ' Department context: ',
            case when array_size(cd.department_user_ai_combined) > 0 then array_to_string(cd.department_user_ai_combined, ', ') else 'Not specified' end,
            '. Main idea: ', c.comment_content
        ) as contextualized_text,
        c.comment_content as original_text,
        null as problem_id,
        null as solution_count,
        cd.department_user_ai_combined
    from TRANSFORM_ENGCA_PRD.ethelo_e3.stg_ethelo_e3_comments as c
    left join TRANSFORM_ENGCA_PRD.ethelo_e3.int_comment_department as cd on c.comment_id = cd.comment_id
    where
        c.comment_content is not null
        and length(c.comment_content) > 10
        and c.reply_to_id is null -- Only top-level comments, not replies
        and c.target = 'Share your idea - Primary problem and ideas to solve the problem' -- Only main ideas
),

problem_solutions as (
    select
        problem_participant_id as participant_id,
        problem_comment_id as comment_id,
        'Processed Problem & Solution' as content_type,
        concat(
            'This is a processed problem and solution pair from California state employee feedback on government efficiency.',
            ' Department context: ',
            case when array_size(department_user_ai_combined) > 0 then array_to_string(department_user_ai_combined, ', ') else 'Not specified' end,
            '. Problem: ', problem_text, ' ',
            ' Solutions: ', array_to_string(consolidated_solutions, ' ')
        ) as contextualized_text,
        concat(
            'PROBLEM: ', problem_text,
            case
                when array_size(consolidated_solutions) > 0
                    then concat(' SOLUTIONS: ', array_to_string(consolidated_solutions, ' | '))
                else ''
            end
        ) as original_text,
        problem_id,
        solution_count,
        department_user_ai_combined
    from ANALYTICS_ENGCA_PRD.ethelo_e3.e3_consolidated_problem_solutions
    where
        problem_text is not null
        and trim(problem_text) != ''
        and consolidation_status = 'SUCCESS'
),

unified_content as (
    select
        participant_id,
        comment_id,
        content_type,
        contextualized_text,
        original_text,
        problem_id,
        solution_count,
        department_user_ai_combined
    from main_ideas

    union all

    select
        participant_id,
        comment_id,
        content_type,
        contextualized_text,
        original_text,
        problem_id,
        solution_count,
        department_user_ai_combined
    from problem_solutions
),

embeddings_added as (
    select
        row_number() over (order by content_type, participant_id, comment_id) as content_id,
        participant_id,
        comment_id,
        content_type,
        contextualized_text,
        original_text,
        problem_id,
        solution_count,
        department_user_ai_combined,

        -- Generate embeddings using the specified model
        snowflake.cortex.embed_text_1024(
            'snowflake-arctic-embed-l-v2.0-8k',
            contextualized_text
        ) as embedding_vector,

        length(contextualized_text) as contextualized_text_length,
        length(original_text) as original_text_length

    from unified_content
    where
        contextualized_text is not null
        and trim(contextualized_text) != ''
        and length(contextualized_text) > 20
)

select
    content_id,
    participant_id,
    comment_id,
    content_type,
    contextualized_text,
    original_text,
    problem_id,
    solution_count,
    department_user_ai_combined,
    embedding_vector,
    contextualized_text_length,
    original_text_length,
    current_timestamp() as processed_at

from embeddings_added
order by content_type, content_id