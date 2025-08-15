--create a comments mart
with comments as (
    select * from {{ ref('int_ethelo_e3_comments_and_responses') }}
)

select
    --overall counts:
    count(distinct comment_id)
        as num_comments,
    count(distinct participant_id)
        as num_participants_w_commments,

    --counts from survey responses:
    --what are you proud of counts:
    count(distinct case
        when question = 'Opening question - What makes you proud about your role in public service?'
            then participant_id
    end)
        as num_what_makes_you_proud_responses,

    --counts from comments:
    --big idea counts:
    count(distinct case
        when
            reply_to_id is null
            and question = 'Share your idea - Primary problem and ideas to solve the problem'
            then comment_id
    end)
        as num_big_idea_comments,
    count(distinct case
        when
            reply_to_id is not null
            and question = 'Share your idea - Primary problem and ideas to solve the problem'
            then comment_id
    end)
        as num_big_idea_replies,

    --what's been working counts:
    count(distinct case
        when
            reply_to_id is null
            and question = 'Share what has been working - Examples'
            then comment_id
    end)
        as num_whats_been_working_comments,
    count(distinct case
        when
            reply_to_id is not null
            and question = 'Share what has been working - Examples'
            then comment_id
    end)
        as num_whats_been_working_replies,

    --anything else counts:
    count(distinct case
        when
            reply_to_id is null
            and question like 'Anything else? - Would you add any other ideas%'
            then comment_id
    end)
        as num_anything_else_comments,
    count(distinct case
        when
            reply_to_id is not null
            and question like 'Anything else? - Would you add any other ideas%'
            then comment_id
    end)
        as num_anything_else_replies,

    max(_file_upload_date) as latest_data_download

from comments
