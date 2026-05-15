with ai_survey as (
    select * from {{ ref('int_govocal_ai_survey') }}
),

ai_users as (
    select * from {{ ref('int_govocal_users_x_ai_survey') }}
)

select 
            s.SURVEY_ID as IDEA_ID,
            s.COUNTY,
            s.FIELD_OF_WORK,
            s.CURRENT_WORK_STATUS,
            s.ROLE_AT_WORK,
            s.AVAILABILITY_FOR_DISCUSSION,
            s.ECONOMIC_IMPACT_EXPECTATION,
            s.GOVERNMENT_ACTION_SUGGESTION,
            s.PERSONAL_AI_IMPACT,
            s.PUBLISHED_AT,
            s.SUBMITTED_AT,
            u.AGE,
            u.GENDER_CATEGORY,
            u.RACE_ETHNICITY_CATEGORY
        FROM ai_survey s
        LEFT JOIN ai_users u
            ON u.USER_ID = s.SURVEY_RESPONDENT_ID