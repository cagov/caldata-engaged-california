SELECT
    c.posted_on,
    c.content,
    ps.problem_text,
    ps.solution_text,
    c.question,
    c.comment_id,
    c.participant_id,
    c.reply_to_id

FROM {{ ref('e3_comments') }} AS c
INNER JOIN {{ ref('int_problem_solution_links') }} AS ps
    ON
        c.comment_id = ps.problem_comment_id
        AND c.comment_id = ps.solution_comment_id
ORDER BY c.posted_on DESC
