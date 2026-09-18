{{ config(materialized='view') }}

-- PII-free view of int_ai_engagement_participants for dashboards and Coda. Same grain and flags;
-- email, names, county, and raw field_of_work are dropped (region and field_of_work_rollup remain).
-- See the intermediate model for how each column is derived.

select
    participant_id,
    survey_respondent_id,
    age,
    gender_array,
    gender_category,
    race_ethnicity_array,
    race_ethnicity_category,
    region,
    field_of_work_rollup,
    current_work_status,
    role_at_work,
    ai_response_label,
    participated_in_phase1,
    invited_to_phase2,
    attended_phase2,
    has_internal_email,
    reported_age_18_plus,
    has_california_region,
    answered_open_text_ai_question,
    meets_phase1_analysis_criteria
from {{ ref('int_ai_engagement_participants') }}
