WITH
problems_and_solutions AS (
    SELECT * FROM {{ ref('int_problem_solution_links') }}
),

comments AS (
    SELECT * FROM {{ ref('e3_comments') }}
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

    FROM problems_and_solutions AS ps -- noqa: ST09
    LEFT JOIN comments AS c_problem
        ON c_problem.comment_id = ps.problem_comment_id
    LEFT JOIN comments AS c_solution
        ON c_solution.comment_id = ps.solution_comment_id
)

SELECT * FROM combined
ORDER BY problem_posted_on DESC
