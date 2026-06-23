with

candidates as (
    select * from {{ ref('int_govocal_sortition_targets') }}
)

select * from candidates
