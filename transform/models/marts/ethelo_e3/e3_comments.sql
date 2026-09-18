select
    c.comment_id,
    c.reply_to_id,
    c.participant_id,
    c.content,
    c.question,
    c.posted_on,
    c.like_count,
    d.department_user_defined,
    d.department_ai_generated,
    d.department_user_ai_combined,
    c._file_upload_date
from {{ ref('int_ethelo_e3_comments_and_responses') }} as c
left join {{ ref('int_comment_department') }} as d on c.comment_id = d.comment_id
