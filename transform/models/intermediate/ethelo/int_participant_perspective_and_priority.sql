with unpivoted as (
    select
        participant,
        target,
        content
    from (
        select
            a.participant,
            a.what_is_your_perspective_on_la_s_recovery_ as main_recovery_perspective,  -- noqa: RF05
            a.what_must_be_addressed_first_to_ensure_a_successful_recovery_ as main_recovery_priority  -- noqa: RF05
        from {{ source('ETHELO', 'SURVEY_BY_EMAIL') }} as a
        inner join {{ ref('stg_participants') }} as b on a.participant = b.participant_id
    ) unpivot (
        content for target in (main_recovery_perspective, main_recovery_priority)
    )
    where length(trim(content)) > 0
)

select
    participant,
    case target
        when 'main_recovery_perspective' then 'Main Recovery Perspective'
        when 'main_recovery_priority' then 'Main Recovery Priority'
    end as target,
    content
from unpivoted
