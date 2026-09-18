

with

targets as (select * from TRANSFORM_ENGCA_PRD.govocal.int_govocal_sortition_targets),

evals as (
    select
        question,
        answer,
        candidate_count,
        target_pct,
        adjusted_target_pct,
        round(adjusted_target_pct * 120, 0) as target,
        greatest(target, 1) * 3 as goal,  -- assumes 66% attrition
        candidate_count / goal as pct_of_goal,
        case
            when candidate_count < target then '⛔ impossible to meet sortition targets'
            when candidate_count < target * 3 then '⚠ more would be good'
            else 'probably have enough respondents'
        end as eval
    from targets
    order by pct_of_goal asc
)

select * from evals