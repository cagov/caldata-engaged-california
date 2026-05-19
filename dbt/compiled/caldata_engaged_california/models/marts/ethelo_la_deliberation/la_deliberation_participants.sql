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
    int.recovery_options_feeling,
    int.opening_outlook,
    int.final_outlook,
    stg.last_invite_sent,
    stg.last_sign_in,
    stg.joined_on,
    stg.airtable_id,
    stg._fivetran_synced

from TRANSFORM_ENGCA_PRD.ethelo_la_deliberation.stg_ethelo_la_deliberation_participants as stg
left join TRANSFORM_ENGCA_PRD.ethelo_la_deliberation.int_participant_survey_responses_wide as int on stg.participant_id = int.participant_id