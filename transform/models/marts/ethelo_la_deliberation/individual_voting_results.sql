with votes as (
    select 
    *,
    case when vote = 'Strongly opposed' then 1
        when vote = 'Opposed' then 2
        when vote = 'Somewhat opposed' then 3
        when vote = 'Neutral' then 4
        when vote = 'Somewhat supportive' then 5
        when vote = 'Supportive' then 6
        when vote = 'Strongly supportive' then 7
    end as vote_number 
    from {{ ref('int_participant_voting_responses_wide') }}

),

--bring in current vote consensus to rank options
vote_summary as (
    select * from {{ ref('stg_ethelo_la_deliberation_voting_summary') }}
),

--bring in one comment per person x vote option combination
--if participant left multple comments on an option, comment is chosen as:
    --most liked
    --most replied
    --otherwise, arbitrary
comments as (
    select 
    posted_by_id,
    comment_id,
    comment_content,
    like_count,
    reply_count,
    target,        
    ROW_NUMBER() OVER ( PARTITION BY posted_by_id, target ORDER BY like_count, reply_count desc ) as comment_rank
    from {{ ref('stg_ethelo_la_deliberation_comments') }}
),

final_table as (
    select 
        votes.*,
        vote_summary.consensus,
        comments_ranked.comment_id,
        comments_ranked.comment_content,
        comments_ranked.like_count,
        comments_ranked.reply_count
    from votes 
    join vote_summary on votes.target_name = vote_summary.option
    left join (select * from comments where comments.comment_rank = 1) as comments_ranked
        on votes.participant_id = comments_ranked.posted_by_id 
        and votes.target_name = comments_ranked.target

)

select * from final_table
order by consensus asc -- this order by is helpful for data viz