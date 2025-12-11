-- depends_on: {{ ref('int_extracted_solutions') }}

{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['solution_id'],
    on_schema_change='sync_all_columns'
) }}

-- noqa: disable=LT02
-- the `is_incremental()` causes issues with the linter. Disabling indentation QA for this CTE only.
with solutions as (
    select
        s.solution_id,
        s.comment_id as solution_comment_id,
        s.reply_to_id,
        s.source_comment,
        s.solution_sequence,
        s.solution_text
    from {{ ref('int_extracted_solutions') }} as s

        {% if is_incremental() %}
            -- Only process solutions that have not yet been processed
            where (s.solution_id) not in
                (
                    select t.solution_id
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

subthemes as (
    select array_agg(object_construct('label', subtheme, 'description', subtheme_description)) as list_of_subthemes
    from theme_map
),

-- classified_solutions CTE uses long lines of text that exceed line length limits.
-- Disabling line length QA for this CTE only.
-- noqa: disable=L016
classified_solutions as (
    select
        s.*,
        ai_classify(
            s.solution_text,
            subthemes.list_of_subthemes,
            {
                'task_description': 'Determine the category that is most related to the'
                || ' given solution idea from a California state employee.',
                'output_mode': 'multi',
                'examples': [
                    {
                        'input': 'Establish a technology procurement review board.',
                        'labels': ['Procurement'],
                        'explanation': 'the text provides a recommendation related to procurement'
                    },
                    {
                        'input': 'Provide enhanced training for managers and supervisors covering leadership skills, effective communication with subordinates, and clear understanding of job duties and descriptions',
                        'labels': ['Manager training'],
                        'explanation': 'even though the text mentions leadership skills and communication, the core idea is enhanced manager training'
                    },
                    {
                        'input': 'Empower staff to make process improvements. Give employees ownership and accountability to create innovative ideas, especially in state contracting from start to finish',
                        'labels': ['Management culture and leadership approach', 'Work culture', 'Trust and openness'],
                        'explanation': 'the text centers on empowering employees and giving trust, so it fits Management culture and leadership approach, Work culture, and Trust and openness'
                    }
                ]
            }):labels
            as solution_subthemes_array
    from solutions as s
    inner join subthemes as subthemes on 1 = 1
)
-- noqa: enable=L016

select
    solution_id,
    solution_comment_id,
    reply_to_id,
    source_comment,
    solution_sequence,
    solution_text,
    solution_subthemes_array
from classified_solutions
