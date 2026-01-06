with
solution_themes as (
    select * from {{ ref('e3_solution_themes') }}
),

theme_map as (
    select
        main_theme,
        subtheme,
        subtheme_description
    from {{ source('UX_AND_RESEARCH', 'E3_ALL_COMMENTS_THEME_MAPPING') }}
),

-- polished CTE uses long lines of text that exceed line length limits.
-- Disabling line length QA for this CTE only.
-- noqa: disable=L016
-- refine solution subthemes manually
polished as (
    select
        *,
        case
            when solution_id = 0  -- placeholder
                then parse_json(
                    '[]'
                )
            else solution_subthemes_array
        end as polished_solution_subthemes_array,
        array_size(polished_solution_subthemes_array) as num_solution_subthemes
    from solution_themes
),
-- noqa: enable=L016

flattened_subthemes as (
    select
        p.*,
        f.value::STRING as solution_subtheme
    from polished as p,
        lateral flatten(input => p.polished_solution_subthemes_array, outer => true) as f
    where f.value is not null and trim(f.value::STRING) != ''
),

-- attach main themes to subthemes
main_themes as (
    select
        f.solution_id,
        f.solution_comment_id,
        f.reply_to_id,
        f.source_comment,
        f.solution_sequence,
        -- add missing periods at end of solution_text when they are not present
        case
            when right(trim(f.solution_text), 1) != '.'
                then concat(trim(f.solution_text), '.')
            else f.solution_text
        end as solution_text,
        f.polished_solution_subthemes_array,
        f.num_solution_subthemes,
        f.solution_subtheme,
        tm.main_theme as solution_main_theme
    from flattened_subthemes as f
    left join theme_map as tm
        on f.solution_subtheme = tm.subtheme
)

select * from main_themes
