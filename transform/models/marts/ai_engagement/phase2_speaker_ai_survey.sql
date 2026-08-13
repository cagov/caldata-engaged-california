with

speaker_gv_ids as (
    select * from {{ ref('int_phase2_speaker_gv_ids') }}
),

sortition_candidates as (
    select * from {{ ref('govocal_sortition_candidates') }}
),

survey_responses as (
    select * from {{ ref('int_govocal_users_x_ai_survey' ) }}
)

select
    s.survey_respondent_id,
    s.session_date,
    s.speaker,
    s.speaker_id,
    s.session_id,
    s.attendee_status,
    sr.age,
    sr.gender_array,
    sr.gender_category,
    sr.race_ethnicity_array,
    sr.race_ethnicity_category,
    sr.current_work_status,
    sr.role_at_work,
    sr.county,
    sr.region,
    sr.field_of_work,
    sc.field_of_work as field_of_work_sortition_grouping,
    sc.ai_response_label,
    sr.economic_impact_expectation,
    sr.government_action_suggestion,
    sr.personal_ai_impact,
    sr.fields_completed_count
from speaker_gv_ids as s
left join sortition_candidates as sc
    on s.survey_respondent_id = sc.survey_respondent_id
left join survey_responses as sr
    on s.survey_respondent_id = sr.survey_respondent_id
