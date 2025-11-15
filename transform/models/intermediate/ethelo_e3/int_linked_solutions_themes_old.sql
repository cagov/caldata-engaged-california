-- this model links all solutions to their themes (by comment id)

with problem_solution_comments as (
    select * from {{ ref('e3_problems_solutions_comments') }}
),

topic_themes as (
    -- avoid duplicate theme rows per comment
    select distinct
        comment_id,
        polished_main_theme_array,
        polished_subthemes_array
    from {{ ref('e3_topic_themes_ux_ai') }}
),

comments as (
    select * from {{ ref('e3_comments') }}
),

-- pre-aggregate likes at the comment level to avoid duplication
comment_likes as (
    select
        comment_id,
        sum(coalesce(like_count, 0)) as like_count
    from comments
    where comment_id is not null
    group by comment_id

),

-- maps replies to parent comment (or self when top-level)
mapped_comments as (
    select
        comment_id,
        reply_to_id,
        coalesce(reply_to_id, comment_id) as mapped_comment_id
    from comments
),

combined as (
    select
        psc.solution_text_id,
        psc.solution_text,
        psc.problem_text,
        tt.polished_main_theme_array as llm_ai_themes,
        tt.polished_subthemes_array as llm_ai_subthemes,
        -- sum likes across joined comment_likes rows; group by original solution/problem/text/theme
        sum(coalesce(cls.like_count, 0) + coalesce(clp.like_count, 0)) as total_likes
    from problem_solution_comments as psc
    -- map solution comment to its parent when present so replies can inherit parent's themes
    left join mapped_comments as mc
        on psc.comment_id_linked_to_solution = mc.comment_id
        or psc.comment_id_linked_to_problem = mc.comment_id
    left join topic_themes as tt
        on tt.comment_id = mc.mapped_comment_id
    left join comment_likes as cls
        on psc.comment_id_linked_to_solution = cls.comment_id
    left join comment_likes as clp
        on psc.comment_id_linked_to_problem = clp.comment_id
    group by
        psc.solution_text_id,
        psc.solution_text,
        psc.problem_text,
        tt.polished_main_theme_array,
        tt.polished_subthemes_array
)

select * from combined
