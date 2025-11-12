-- this model links all solutions to their themes (by comment id)

with problem_solution_comments as (
    select * from {{ ref('e3_problems_solutions_comments') }}
),

topic_themes as (
    -- avoid duplicate theme rows per comment
    select distinct
        comment_id,
        ux_main_idea_primary_theme,
        llm_main_idea_primary_theme_array
    from {{ ref('e3_topic_themes_ux_ai') }}
),

-- pre-aggregate likes at the comment level to avoid duplication
comment_likes as (
    select
        comment_id,
        sum(coalesce(like_count, 0)) as like_count
    from {{ ref('e3_comments') }}
    where comment_id is not null
    group by comment_id

),

combined as (
    select
        psc.solution_text_id,
        psc.solution_text,
        psc.problem_text,
        tt.ux_main_idea_primary_theme as ux_manual_theme,
        tt.llm_main_idea_primary_theme_array as llm_ai_themes,
        -- sum likes across joined comment_likes rows; group by original solution/problem/text/theme
        sum(coalesce(cls.like_count, 0) + coalesce(clp.like_count, 0)) as total_likes
    from problem_solution_comments as psc
    left join topic_themes as tt
        on psc.comment_id_linked_to_solution = tt.comment_id
    left join comment_likes as cls
        on psc.comment_id_linked_to_solution = cls.comment_id
    left join comment_likes as clp
        on psc.comment_id_linked_to_problem = clp.comment_id
    group by
        psc.solution_text_id,
        psc.solution_text,
        psc.problem_text,
        tt.ux_main_idea_primary_theme,
        tt.llm_main_idea_primary_theme_array
)

select * from combined
where ux_manual_theme is not null
