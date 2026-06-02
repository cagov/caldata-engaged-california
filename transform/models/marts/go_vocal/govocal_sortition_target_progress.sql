{% set num_participants = 120 %}

with

targets as (select * from {{ ref('int_govocal_sortition_targets') }}),

evals as (
    select
        question,
        answer,
        candidates_count,
        target_pct,
        adjusted_target_pct,
        round(adjusted_target_pct * {{ num_participants }}, 0) as target,
        target * 3 as goal,  -- assumes 66% attrition
        candidates_count / goal as pct_of_goal,
        case
            when candidates_count < target then '⛔ impossible to meet sortition targets'
            when candidates_count < target * 3 then '⚠ more would be good'
            else 'probably have enough respondents'
        end as eval
    from targets
    order by pct_of_goal asc
)

select * from evals
