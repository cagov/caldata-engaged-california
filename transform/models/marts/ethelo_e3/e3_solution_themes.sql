/*
This model attempts to shape the solutions data to make it easier to select "top solutions" from the E3 dataset.
First, it takes the extracted solution statements that have previously been output, and uses AI to expand the list
with shorter, more specific solution statements. Next, it takes the subtheme/main theme map and labels
each shortened solution statement with one or more subthemes (and their accompanying main themes).
The final output is a list of solution statements, with one row per solution.
*/

{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['solution_comment_id', 'solution_sequence'],
    on_schema_change='sync_all_columns'
) }}

-- noqa: disable=LT02
-- the `is_incremental()` causes issues with the linter. Disabling indentation QA for this CTE only.
with solutions as (
    select distinct
    s.comment_id as solution_comment_id,
    s.reply_to_id,
    s.source_comment,
    s.solution_sequence,
    s.solution_text
    from {{ ref('int_extracted_solutions') }} as s

        {% if is_incremental() %}
            -- Only process solutions that have not yet been processed
            where (s.comment_id, s.solution_sequence) not in
                (
                    select
                        t.solution_comment_id,
                        t.solution_sequence
                    from {{ this }} as t
                )
        {% endif %}
),
-- noqa: enable=LT02

theme_map as (
    select
        main_theme,
        subtheme,
        subtheme_description
    from {{ source('UX_AND_RESEARCH', 'E3_ALL_COMMENTS_THEME_MAPPING') }}
),

-- Use AI to extract shorter solutions from each solution statement
-- solution_exctraction CTE uses long lines of text that exceed line length limits.
-- Disabling line length QA for these CTEs only.
-- noqa: disable=L016
solution_extraction as (
    select
        solutions.solution_comment_id,
        solutions.reply_to_id,
        solutions.source_comment,
        solutions.solution_sequence,
        solutions.solution_text,

        -- Extract solutions using Snowflake Cortex AI with fallback handling.
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
                                    'You are analyzing proposed solutions from California state employees about making the government more efficient. ',
                                    'Shorten each statement to 5-8 words by removing any details about the problem it solves, and summarizing the gist of the solution.\n\n',
                                    'Extract ONLY the general action items, proposed solutions, or recommendations. Ignore problem descriptions, for statements that explain what the solution solves, and department names or acronyms.\n\n',

                                    'COMMENT CONTEXT:\n',
                                    'Comment Content: ', solutions.solution_text, '\n',

                                    'GUIDELINES:\n',
                                    '• Identify main solutions and recommendations, not minor suggestions\n',
                                    '• One solution = one actionable recommendation for leadership\n',
                                    '• Summarize as concisely as possible\n',
                                    '• Focus on substantial, actionable solutions\n',

                                    'JSON OUTPUT REQUIREMENTS:\n',
                                    '• Use only standard alphanumeric characters, spaces, and basic punctuation\n',
                                    '• Avoid special characters like backticks, curly quotes, or extended Unicode\n',
                                    '• Escape quotes properly with backslashes\n',

                                    'EXAMPLES OF COMPREHENSIVE EXTRACTION:\n',
                                    'Input: "Implement contract penalty provisions charging contractors for delays and cost overruns while requiring contractors to absorb additional costs beyond original bid amounts rather than passing them to the state"\n',
                                    'Output: "Implement contract penalties for delays and cost overruns."\n\n',

                                    'Input: "Continue and expand telework programs for state employees to increase efficiency through reduced commuting time, lower overhead costs for office space and utilities, and improved public service responsiveness using secure cloud systems, videoconferencing, and shared databases."\n',
                                    'Output: "Continue and expand telework for state employees"\n\n',

                                    'Input: "Standardize software and tools across all state departments for personnel and HR information, web site content, and project management (SharePoint) similar to the FisCAL effort"\n',
                                    'Output: "Standardize HR software and tools across all departments"\n\n',

                                    'Remember: one solution = one short, actionable recommendation for leadership. Return exactly 1 consolidated solution per comment unless the source comment contains multiple, truly unique solutions.',
                                    'IMPORTANT LENGTH LIMIT: Ensure the **entire** JSON response (including the JSON structure itself) is less than 500 tokens'
                                )
                            }
                        ],
                        object_construct(
                            'temperature', 0.00,
                            'max_tokens', 8000,
                            'top_p', 0.0,
                            'response_format',
                            parse_json(
                                '{"type":"json","schema":{"type":"object","properties":{"solutions":{"type":"array","items":{"type":"string"}}},"required":["solutions"]}}'
                            )
                        )
                    ):structured_output[0]:raw_message
                )
            )::OBJECT,
            -- Fallback: empty array object
            parse_json('{"solutions": []}')::OBJECT
        ) as solutions_json
    from solutions
),
-- noqa: enable=L016

-- Flatten the solutions array to create one row per shortened solution
flattened_solutions as (
    select
        solution_extraction.*,
        solution_extraction.solutions_json:solutions as solutions_array,
        -- Extract individual solution texts
        f.value::STRING as solution_shortened
    from solution_extraction,
        lateral flatten(input => solution_extraction.solutions_json:solutions, outer => true) as f
    where f.value is not null and trim(f.value::STRING) != ''
),

subthemes as (
    select array_agg(object_construct('label', subtheme, 'description', subtheme_description)) as list_of_subthemes
    from theme_map
),

classified_solutions as (
    select
        f.*,
        ai_classify(
            f.solution_shortened,
            subthemes.list_of_subthemes,
            {
                'task_description': 'Determine the category that is most related to the'
                || ' given proposal from a California state employee.',
                'output_mode': 'multi',
                'examples': [
                    {
                        'input': 'Establish a technology procurement review board.',
                        'labels': ['Procurement'],
                        'explanation': 'the text provides a recommendation related to procurement'
                    }
                ]
            }):labels
            as solution_subthemes_array
    from flattened_solutions as f
    inner join subthemes as subthemes on 1 = 1
),

flattened_subthemes as (
    select
        cs.*,
        f.value::STRING as solution_subtheme
    from classified_solutions as cs,
        lateral flatten(input => cs.solution_subthemes_array, outer => true) as f
    where f.value is not null and trim(f.value::STRING) != ''
),

-- aggregate back to one row per shortened solution
main_themes as (
    select
        f.solution_comment_id,
        f.reply_to_id,
        f.source_comment,
        f.solution_sequence,
        f.solution_text,
        f.solutions_array,
        f.solution_shortened,
        f.solution_subthemes_array,
        array_agg(distinct tm.main_theme) as solution_main_themes_array
    from flattened_subthemes as f
    left join theme_map as tm
        on f.solution_subtheme = tm.subtheme
    group by all
)

select * from main_themes
