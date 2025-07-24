select
    stg.participant_id,
    stg.status,
    stg.voting_complete,
    stg.survey_completed,
    stg.completion,
    int.race_ethnicity_array,
    int.income,
    int.age,
    int.gender_identity,
    int.confidence_increase,
    case
        when int.evacuation_zone like '%Eaton%' then 'Eaton'
        when int.evacuation_zone like '%Palisades%' then 'Palisades'
        when int.evacuation_zone like 'No' then 'Other'
    end as evacuation_zone,
    int.civility_pledge,
    int.recovery_options_feeling,
    int.opening_outlook,
    int.final_outlook,
    int.agree_terms,
    int.age_18_or_older,
    stg.last_invite_sent,
    stg.last_sign_in,
    stg.joined_on,
    stg.airtable_id,
    stg._fivetran_synced

from {{ ref('stg_ethelo_la_deliberation_participants') }} as stg
left join {{ ref('int_participant_survey_responses_wide') }} as int on stg.participant_id = int.participant_id
