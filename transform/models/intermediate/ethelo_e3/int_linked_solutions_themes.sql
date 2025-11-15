-- this is the very simple approach Summer and I took 
-- that yielded the same results

with problem_solution_links as (
    select * from {{ ref('int_problem_solution_links') }}
),

topic_themes as (
    select
        comment_id,
        polished_main_theme_array,
        polished_subthemes_array
    from {{ ref('e3_topic_themes_ux_ai') }}
),

combined as (
    select
        ps.solution_comment_id,
        ps.solution_text,
        themes.polished_main_theme_array,
        themes.polished_subthemes_array
    from topic_themes as themes
    left join problem_solution_links as ps
        on themes.comment_id = ps.solution_comment_id
) 

select * from combined
