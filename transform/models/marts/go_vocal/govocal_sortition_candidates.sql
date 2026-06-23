with

candidates as (select * from {{ ref('int_govocal_sortition_candidates') }})

select * from candidates
