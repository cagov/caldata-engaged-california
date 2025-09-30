-- noqa: disable=LT05
{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['problem_comment_id', 'problem_sequence'],
    on_schema_change='sync_all_columns'
) }}


-- noqa: disable=LT02
-- the `is_incremental()` block is causing issues with the linter. Disabling indentation QA for this CTE only.

-- Consolidated problem-solution pairs using AI to merge solutions for each problem
-- One row per problem with AI-consolidated solutions and full traceability
with problem_solution_links as (
    select
        psl.problem_comment_id,
        psl.problem_participant_id,
        psl.problem_posted_on,
        psl.problem_sequence,
        psl.problem_text,
        psl.solution_comment_id,
        psl.solution_participant_id,
        psl.solution_posted_on,
        psl.solution_sequence,
        psl.solution_text,
        psl.link_type,
        psl.confidence_score,
        psl.link_explanation,
        psl.final_link_score,
        psl.link_id,
        psl.linked_at,
        p.all_departments
    from {{ ref('int_problem_solution_links') }} as psl
    left join {{ ref('int_extracted_problems') }} as p
        on (
            psl.problem_comment_id = p.comment_id
            and psl.problem_participant_id = p.participant_id
            and psl.problem_posted_on = p.posted_on
            and psl.problem_sequence = p.problem_sequence
        )

    {% if is_incremental() %}
        -- Only process problems that are new since last run
        where psl.problem_posted_on > (select max(t.problem_posted_on) from {{ this }} as t)
    {% endif %}

),
-- noqa: enable=LT02

-- Aggregate solutions for each problem
problems_with_solutions as (
    select
        problem_comment_id,
        problem_participant_id,
        problem_posted_on,
        problem_sequence,
        problem_text,

        -- Department information (should be the same for all rows in group)
        any_value(all_departments) as all_departments,

        -- Count of linked solutions
        count(*) as solution_count,

        -- Average confidence score
        avg(final_link_score) as avg_confidence_score,

        -- Concatenate all solution texts for AI processing
        listagg(
            concat(
                'Solution ', solution_sequence, ' (from comment ', solution_comment_id, ', confidence: ',
                round(final_link_score, 2), ', type: ', link_type, '): ', solution_text
            ),
            '\n\n'
        ) within group (order by final_link_score desc) as all_solutions_text,

        -- Create traceability information
        listagg(
            concat(
                solution_comment_id, '-', solution_sequence, '(', round(final_link_score, 2), ')'
            ),
            '; '
        ) within group (order by final_link_score desc) as solution_trace_ids,

        -- Link type distribution
        listagg(distinct link_type, ', ') within group (order by link_type) as link_types_used,

        -- Date range of solutions
        min(solution_posted_on) as earliest_solution_date,
        max(solution_posted_on) as latest_solution_date

    from problem_solution_links
    group by
        problem_comment_id,
        problem_participant_id,
        problem_posted_on,
        problem_sequence,
        problem_text
),

-- Use AI to consolidate solutions for each problem
ai_consolidated as (
    select
        problem_comment_id,
        problem_participant_id,
        problem_posted_on,
        problem_sequence,
        problem_text,
        all_departments,
        solution_count,
        avg_confidence_score,
        all_solutions_text,
        solution_trace_ids,
        link_types_used,
        earliest_solution_date,
        latest_solution_date,

        -- Use AI to consolidate and synthesize solutions with fallback handling
        -- TRY_COMPLETE returns response metadata; actual JSON is nested at structured_output[0].raw_message
        -- Using TRY_COMPLETE instead of AI_COMPLETE for NULL-on-failure vs hard error on malformed JSON
        -- We use TRY_COMPLETE because with the structured output, the smaller models we use in dev are more likely to have issues. See snowflake documentation for details.
        coalesce(
            try_parse_json(
                to_json(
                    SNOWFLAKE.CORTEX.TRY_COMPLETE(
                        '{{ var("llm_model") }}',
                        [
                            {
                                'role': 'user',
                                'content': concat(
                                    'You are analyzing solutions proposed for a specific government efficiency problem. ',
                                    'Your task is to consolidate multiple related solutions into a coherent, comprehensive, and orthogonal solution set.\n\n',  -- noqa: LT05

                                    'PROBLEM TO SOLVE:\n',
                                    problem_text, '\n\n',

                                    'PROPOSED SOLUTIONS:\n',
                                    all_solutions_text, '\n\n',

                                    'CONSOLIDATION INSTRUCTIONS:\n',
                                    '- Analyze all proposed solutions and identify common themes\n',
                                    '- You must merge similar or overlapping solutions into unified recommendations\n',
                                    '- Preserve unique value from each distinct solution approach\n',
                                    '- Preserve specific program names, systems, and technologies mentioned\n',
                                    '- Ensure each consolidated solution is specific and actionable\n',
                                    '- Maintain the practical focus on government efficiency improvements\n',
                                    '- Remember: one solution = one actionable recommendation for leadership\n',
                                    '- Return exactly 1 consolidated solution per problem unless the source contains multiple, truly unique solutions\n\n',

                                    'JSON OUTPUT REQUIREMENTS:\n',
                                    '- Use only standard alphanumeric characters, spaces, and basic punctuation\n',
                                    '- Avoid special characters like backticks, curly quotes, or extended Unicode\n',
                                    '- Escape quotes properly with backslashes\n',
                                    'IMPORTANT LENGTH LIMIT: Ensure the **entire** JSON response (including the JSON structure itself) is less than 500 tokens.\n\n',

                                    'OUTPUT REQUIREMENTS:\n',
                                    '- consolidated_solutions: Array of 1-3 consolidated solution descriptions\n',
                                    '- solution_themes: Array of key themes identified across all solutions\n\n'
                                )
                            }
                        ],
                        object_construct(
                            'temperature', 0.00,
                            'max_tokens', 8000,
                            'top_p', 0.0,
                            'response_format', parse_json('{"type":"json","schema":{"type":"object","properties":{"consolidated_solutions":{"type":"array","items":{"type":"string"}},"solution_themes":{"type":"array","items":{"type":"string"}}},"required":["consolidated_solutions","solution_themes"]}}')
                        )
                    ):structured_output[0]:raw_message
                )
            ),
            -- Fallback: return empty arrays if JSON parsing fails
            parse_json('{"consolidated_solutions": [], "solution_themes": []}')
        ) as consolidation_analysis
    from problems_with_solutions
)

select
    -- Primary identifiers
    problem_comment_id,
    problem_participant_id,
    problem_posted_on,
    problem_sequence,

    -- Problem information
    problem_text,
    length(problem_text) as problem_length,

    -- Department information
    all_departments,

    -- Solution aggregation metadata
    solution_count,
    round(avg_confidence_score, 3)::float as avg_confidence_score,
    link_types_used,
    earliest_solution_date,
    latest_solution_date,

    -- AI consolidation results
    coalesce(consolidation_analysis:consolidated_solutions, []) as consolidated_solutions,
    coalesce(consolidation_analysis:solution_themes, []) as solution_themes,

    -- Traceability back to source data
    solution_trace_ids,
    all_solutions_text as original_solutions_detail,

    -- Metadata
    case
        when consolidation_analysis is not null then 'SUCCESS'
        else 'FAILED'
    end as consolidation_status,

    -- Create unique problem identifier
    concat(problem_comment_id, '-', problem_sequence) as problem_id,

    current_timestamp() as consolidated_at

from ai_consolidated
order by
    avg_confidence_score desc,
    solution_count desc,
    problem_posted_on desc
