-- noqa: disable=LT05
-- Unified embedding table containing both raw main ideas and processed problem/solution pairs
-- Each row represents one text item with consistent embeddings for similarity analysis

with main_ideas as (
    select
        participant_id,
        main_idea,
        idea_dept,
        'Raw Main Idea' as content_type,
        concat(
            'This is a main idea submitted by a California state employee for improving government efficiency. ',
            'Department context: ', coalesce(idea_dept, 'Not specified'), '. ',
            'Main idea: ', main_idea
        ) as contextualized_text,
        main_idea as original_text,
        null as problem_id,
        null as solution_count,
        null as avg_confidence_score,
        null as departments,
        _file_upload_date
    from {{ ref('e3_participant_responses') }}
    where
        main_idea is not null
        and trim(main_idea) != ''
        and length(main_idea) > 10
),

problem_solutions as (
    select
        problem_participant_id as participant_id,
        concat(problem_text, ' ', array_to_string(consolidated_solutions, ' ')) as combined_content,
        null as idea_dept,
        'Processed Problem & Solution' as content_type,
        concat(
            'This is a processed problem and solution pair from California state employee feedback on government efficiency. ',
            'Departments involved: ', coalesce(array_to_string(all_departments, ', '), 'Not specified'), '. ',
            'Problem: ', problem_text, ' ',
            'Solutions: ', array_to_string(consolidated_solutions, ' ')
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
        avg_confidence_score,
        all_departments as departments,
        consolidated_at as _file_upload_date
    from {{ ref('e3_consolidated_problem_solutions') }}
    where
        problem_text is not null
        and trim(problem_text) != ''
        and consolidation_status = 'SUCCESS'
),

unified_content as (
    select
        participant_id,
        content_type,
        contextualized_text,
        original_text,
        problem_id,
        solution_count,
        avg_confidence_score,
        departments,
        _file_upload_date,
        row_number() over (order by _file_upload_date, participant_id) as content_id
    from main_ideas

    union all

    select
        participant_id,
        content_type,
        contextualized_text,
        original_text,
        problem_id,
        solution_count,
        avg_confidence_score,
        departments,
        _file_upload_date,
        row_number() over (order by _file_upload_date, participant_id)
        + (select count(*) from main_ideas) as content_id
    from problem_solutions
),

embeddings_added as (
    select
        content_id,
        participant_id,
        content_type,
        contextualized_text,
        original_text,
        problem_id,
        solution_count,
        avg_confidence_score,
        departments,
        _file_upload_date,

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
    content_type,
    contextualized_text,
    original_text,
    problem_id,
    solution_count,
    departments,
    embedding_vector,
    contextualized_text_length,
    original_text_length,
    _file_upload_date,
    current_timestamp() as processed_at

from embeddings_added
order by content_type, content_id
