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
            when solution_id = 2240 then parse_json('["Work culture"]')
            when solution_id = 2255 then parse_json('["Software and tools"]')
            when solution_id = 1833 then parse_json('["Public policy initiatives"]')
            when solution_id = 27 then parse_json('["Process design and methodologies", "Work culture"]')
            when solution_id = 101 then parse_json('["Software and tools", "Office management", "Compliance"]')
            when solution_id = 140 then parse_json('["Employee training", "Work culture", "Trust and openness"]')
            when solution_id = 300 then parse_json('["Compliance"]')
            when solution_id = 302 then parse_json('["Compliance"]')
            when solution_id = 328 then parse_json('["Process design and methodologies"]')
            when solution_id = 493 then parse_json('["Public service delivery and responsiveness"]')
            when solution_id = 559 then parse_json('["Office management"]')
            when solution_id = 808 then parse_json('["Work culture"]')
            when solution_id = 1044 then parse_json('["Hiring and recruitment"]')
            when solution_id = 661 then parse_json('["Public policy initiatives"]')
            when solution_id = 2245 then parse_json('["Software and tools", "Digitize processes"]')
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
        f.solution_id as idea_id,
        f.solution_comment_id as idea_comment_id,
        f.reply_to_id,
        f.source_comment,
        f.solution_sequence as idea_sequence,
        -- add missing periods at end of solution_text when they are not present
        case
            when right(trim(f.solution_text), 1) != '.'
                then concat(trim(f.solution_text), '.')
            else f.solution_text
        end as idea_text,
        f.polished_solution_subthemes_array as polished_idea_subthemes_array,
        f.num_solution_subthemes as num_idea_subthemes,
        f.solution_subtheme as idea_subtheme,
        tm.main_theme as idea_main_theme
    from flattened_subthemes as f
    left join theme_map as tm
        on f.solution_subtheme = tm.subtheme
)

select * from main_themes
