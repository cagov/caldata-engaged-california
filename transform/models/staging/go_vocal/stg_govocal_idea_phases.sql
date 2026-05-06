with

idea_phases as (select * from {{ source('GOVOCAL', 'IDEA_PHASES') }})

select
    idea_id,
    phase_id,
    baskets_count,
    votes_count,
    created_at::timestamp_ltz as created_at,
    updated_at::timestamp_ltz as updated_at,
    _load_date,
    _loaded_at
from idea_phases
