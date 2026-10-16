

select
    topic_id,
    content_type,
    topic_member_count,
    topic_name,
    topic_description,
    representative_quotes,
    comments_for_labeling
from TRANSFORM_ENGCA_PRD.ethelo_e3.int_e3_topic_labeling
order by content_type, topic_id