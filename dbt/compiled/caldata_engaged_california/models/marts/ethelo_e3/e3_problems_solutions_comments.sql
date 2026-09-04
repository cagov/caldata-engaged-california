WITH
problems_and_solutions AS (
    SELECT * FROM TRANSFORM_ENGCA_PRD.ethelo_e3.int_problem_solution_links
),

comments AS (
    SELECT * FROM ANALYTICS_ENGCA_PRD.ethelo_e3.e3_comments
),

combined AS (

    SELECT
        -- problem side
        c_problem.comment_id AS comment_id_linked_to_problem,
        ps.problem_comment_id AS problem_text_id,
        ps.problem_posted_on,
        ps.problem_text,
        c_problem.content AS comment_linked_to_problem,

        -- solution side
        c_solution.comment_id AS comment_id_linked_to_solution,
        ps.solution_comment_id AS solution_text_id,
        ps.solution_posted_on,
        ps.solution_text,
        c_solution.content AS comment_linked_to_solution

    FROM problems_and_solutions AS ps
    LEFT JOIN comments AS c_problem -- noqa: ST09
        ON ps.problem_comment_id = c_problem.comment_id
    LEFT JOIN comments AS c_solution
        ON ps.solution_comment_id = c_solution.comment_id
)

SELECT * FROM combined
ORDER BY problem_posted_on DESC