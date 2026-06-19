with

candidates as (
    select * from {{ ref('int_govocal_sortition_candidates') }}
),

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
        accepted_count / invited_count as accept_rate
    from candidates
    unpivot (
        answer for question in (age, gender_category, race_ethnicity_category, region, field_of_work, ai_response_label)
    )
    group by question, answer
)

select * from cand_counts
