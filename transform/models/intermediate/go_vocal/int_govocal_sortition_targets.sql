with

candidate_counts as (select * from {{ ref('int_govocal_sortition_candidate_counts') }}),

sortition_targets as (select * from {{ source('DEMOGRAPHICS', 'AI_SORTITION_TARGETS') }}),

nonresponsepercents as (
    select
        question,
        sum(iff(answer = 'Non-response', candidates_count, 0)) / sum(candidates_count) as nonresponse_pct
    from candidate_counts
    group by question
),

targets as (
    select
        cc.question,
        cc.answer,
        cc.candidates_count,
        st.target_pct,
        -- scale down the target percentages based on the actual non-response percentages
        case when cc.answer = 'Non-response' then np.nonresponse_pct else st.target_pct * (1 - np.nonresponse_pct) end
            as adjusted_target_pct
    from candidate_counts as cc
    left join
        sortition_targets as st
        on lower(cc.question) = lower(st.category) and lower(cc.answer) = lower(st.name)
    left join nonresponsepercents as np on lower(cc.question) = lower(np.question)
)

select * from targets
order by question asc, answer asc, adjusted_target_pct desc
