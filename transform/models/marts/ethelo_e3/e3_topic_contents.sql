{{ config(materialized='table') }}

with base as (
    select
        content_type,
        topic_id,
        content_id,
        participant_id,
        original_text,
        topic_probability,
        is_outlier,
        umap_x,
        umap_y
    from {{ ref('int_e3_topic_modeling') }}
),

labels as (
    select
        content_type,
        topic_id,
        topic_name
    from {{ ref('int_e3_topic_labeling') }}
)

select
    b.content_type,
    b.topic_id,
    l.topic_name,
    b.content_id,
    b.participant_id,
    b.original_text,
    b.topic_probability,
    b.is_outlier,
    b.umap_x,
    b.umap_y
from base as b
left join labels as l
    on
        b.content_type = l.content_type
        and b.topic_id = l.topic_id
order by b.content_type, b.content_id
