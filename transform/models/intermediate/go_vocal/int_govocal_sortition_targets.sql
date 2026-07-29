with

candidates as (select * from {{ ref('int_govocal_sortition_candidates') }}),

sortition_targets as (select * from {{ source('DEMOGRAPHICS', 'AI_SORTITION_TARGETS') }}),

cand_counts as (
    select
        question,
        answer,
        count(*) as candidate_count,
        count_if(invitee_status <> 'not yet invited') as invited_count,
        count_if(invitee_status = 'not yet invited') as not_yet_invited_count,
        count_if(invitee_status = 'accepted') as accepted_count,
        count_if(invitee_status = 'declined' or invitee_status = 'invitation closed') as declined_count,
        count_if(invitee_status = 'invitation open') as invited_no_response_count,
        count_if(attendee_status = 'attended') as attended_count,
        count_if(attendee_status = 'no show') as no_show_count,
        count_if(attendee_status = 'session in the future') as future_event_registration_count,
        div0(accepted_count, invited_count) as accept_rate,
        div0(accepted_count, sum(accepted_count) over (partition by question)) as registered_pct_of_total,
        div0(attended_count, accepted_count - future_event_registration_count) as attendance_rate,
        div0(attended_count, sum(attended_count) over (partition by question)) as attended_pct_of_total
    from candidates
    unpivot (
        answer for question in (age, gender_category, race_ethnicity_category, region, field_of_work, ai_response_label)
    )
    group by question, answer
),

nonresponsepercents as (
    select
        question,
        sum(iff(answer = 'Non-response', candidate_count, 0)) / sum(candidate_count) as nonresponse_pct
    from cand_counts
    group by question
),

targets as (
    select
        cc.*,
        st.target_pct,
        -- scale down the target percentages based on the actual non-response percentages
        case when cc.answer = 'Non-response' then np.nonresponse_pct else st.target_pct * (1 - np.nonresponse_pct) end
            as adjusted_target_pct
    from cand_counts as cc
    left join
        sortition_targets as st
        on lower(cc.question) = lower(st.category) and lower(cc.answer) = lower(st.name)
    left join nonresponsepercents as np on lower(cc.question) = lower(np.question)
)

select * from targets
order by question asc, answer asc, adjusted_target_pct desc
