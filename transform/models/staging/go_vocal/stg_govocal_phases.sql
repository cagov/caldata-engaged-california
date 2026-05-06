with

phases as (select * from {{ source('GOVOCAL', 'PHASES') }})

select
    id as phase_id,
    title,
    description,
    participation_method,
    project_id,
    project_title,
    created_at::timestamp_ltz as created_at,
    updated_at::timestamp_ltz as updated_at,
    ideas_count,
    baskets_count,
    votes_count,
    submission_enabled,
    autoshare_results_enabled,
    commenting_enabled,
    reacting_enabled,
    reacting_like_method,
    reacting_like_limited_max,
    reacting_dislike_enabled,
    reacting_dislike_method,
    reacting_dislike_limited_max,
    voting_method,
    voting_max_total,
    voting_min_total,
    _load_date,
    _loaded_at
from phases
