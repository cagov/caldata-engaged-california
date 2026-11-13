

-- Link extracted problems to extracted solutions using multiple approaches
-- This creates a many-to-many relationship between problems and solutions

with problems as (
    select
        comment_id,
        participant_id,
        posted_on,
        problem_sequence,
        reply_to_id,
        source_comment,
        source_question,
        problem_text,
        problem_length,
        processed_at as problem_processed_at
    from TRANSFORM_ENGCA_PRD.ethelo_e3.int_extracted_problems
),

solutions as (
    select
        comment_id,
        participant_id,
        posted_on,
        solution_sequence,
        reply_to_id,
        parent_comment_id,
        source_comment,
        source_question,
        solution_text,
        solution_length,
        processed_at as solution_processed_at
    from TRANSFORM_ENGCA_PRD.ethelo_e3.int_extracted_solutions
),

-- Approach 1: Direct reply linking - solutions in comments that reply to problem comments
direct_reply_links as (
    select
        p.comment_id as problem_comment_id,
        p.participant_id as problem_participant_id,
        p.posted_on as problem_posted_on,
        p.problem_sequence,
        p.problem_text,
        s.comment_id as solution_comment_id,
        s.participant_id as solution_participant_id,
        s.posted_on as solution_posted_on,
        s.solution_sequence,
        s.solution_text,
        'DIRECT_REPLY' as link_type,
        1.0 as confidence_score,
        'Solution found in direct reply to problem comment' as link_explanation
    from problems as p
    inner join solutions as s on p.comment_id = s.reply_to_id
),

-- Approach 2: Same comment linking - problems and solutions in the same comment
same_comment_links as (
    select
        p.comment_id as problem_comment_id,
        p.participant_id as problem_participant_id,
        p.posted_on as problem_posted_on,
        p.problem_sequence,
        p.problem_text,
        s.comment_id as solution_comment_id,
        s.participant_id as solution_participant_id,
        s.posted_on as solution_posted_on,
        s.solution_sequence,
        s.solution_text,
        'SAME_COMMENT' as link_type,
        0.9 as confidence_score,
        'Problem and solution found in the same comment' as link_explanation
    from problems as p
    inner join solutions as s on (
        p.comment_id = s.comment_id
        and p.participant_id = s.participant_id
        and p.posted_on = s.posted_on
    )
),

-- Approach 3: Thread-based linking - solutions in any comment that replies to a problem thread
thread_links as (
    select
        p.comment_id as problem_comment_id,
        p.participant_id as problem_participant_id,
        p.posted_on as problem_posted_on,
        p.problem_sequence,
        p.problem_text,
        s.comment_id as solution_comment_id,
        s.participant_id as solution_participant_id,
        s.posted_on as solution_posted_on,
        s.solution_sequence,
        s.solution_text,
        'THREAD_REPLY' as link_type,
        0.7 as confidence_score,
        'Solution found in reply chain to problem comment' as link_explanation
    from problems as p
    inner join solutions as s
        on (
            p.comment_id = s.parent_comment_id
            and s.reply_to_id is not null
        )
    -- Exclude direct replies (already captured above)
    where not exists (
        select 1 from direct_reply_links as d
        where
            d.problem_comment_id = p.comment_id
            and d.solution_comment_id = s.comment_id
    )
),

-- Combine all linking approaches
all_links as (
    select * from direct_reply_links
    union all
    select * from same_comment_links
    union all
    select * from thread_links
)

select
    problem_comment_id,
    problem_participant_id,
    problem_posted_on,
    problem_sequence,
    problem_text,
    solution_comment_id,
    solution_participant_id,
    solution_posted_on,
    solution_sequence,
    solution_text,
    link_type,
    confidence_score,
    link_explanation,

    -- Create a composite linking score
    case
        when link_type = 'DIRECT_REPLY' then confidence_score * 1.0
        when link_type = 'SAME_COMMENT' then confidence_score * 0.9
        when link_type = 'THREAD_REPLY' then confidence_score * 0.7
        else confidence_score * 0.5
    end as final_link_score,

    -- Generate unique link identifier
    concat(
        problem_comment_id, '-', problem_sequence,
        '_TO_',
        solution_comment_id, '-', solution_sequence
    ) as link_id,

    current_timestamp() as linked_at

from all_links
order by final_link_score desc, link_type asc, problem_posted_on desc