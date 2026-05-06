with

ideas as (select * from {{ ref('stg_govocal_ideas') }}),

ai_survey as (
    select *
    from ideas
    where
        survey_title = 'Impact of AI on work'
        and idea_type = 'survey'  -- the filter on survey_title may be sufficient on its own
),

-- disable LTO5 for this CTE because the survey question lengths exceed the line length limit.
-- noqa: disable=LT05
extract_survey_responses as (
    select
        *,
        -- Extract survey responses from custom field values
        custom_field_values:"are_you_currently_working_x5c"::string as current_work_status,
        custom_field_values:"what_is_your_role_at_work_8zv"::string as role_at_work,
        custom_field_values:"which_county_do_you_live_in_fo1"::string as county,
        custom_field_values:"which_best_describes_your_field_of_work_t10"::string as field_of_work,
        custom_field_values:"what_do_you_expect_the_impact_of_ai_to_be_on_the_economy_9f4"::string as economic_impact_expectation,
        custom_field_values:"what_would_you_like_to_the_government_to_do_about_what_you_see_as_these_impacts_l51"::string as government_action_suggestion,
        custom_field_values:"what_has_been_your_experience_if_any_of_the_impact_of_ai_on_your_own_job_and_workplace_w1q"::string as personal_ai_impact,
        custom_field_values:"we_will_invite_some_participants_to_give_their_thoughts_on_ai_in_a_live_discussion_are_you_open_to_joining_that_s9k"::string as availability_for_discussion
    from ai_survey
)
-- noqa: enable=LT05

select
    idea_id,
    author_id,
    published_at,
    submitted_at,
    publication_status,
    created_at,
    updated_at,
    href,
    custom_field_values,
    left(current_work_status, length(current_work_status) - 4) as current_work_status,
    left(role_at_work, length(role_at_work) - 4) as role_at_work,
    left(county, length(county) - 4) as county,
    left(field_of_work, length(field_of_work) - 4) as field_of_work,
    economic_impact_expectation,
    government_action_suggestion,
    personal_ai_impact,
    left(availability_for_discussion, length(availability_for_discussion) - 4) as availability_for_discussion,

    -- Count the number of survey fields completed by each respondent.
    (
        iff(current_work_status is not null, 1, 0)
        + iff(role_at_work is not null, 1, 0)
        + iff(county is not null, 1, 0)
        + iff(field_of_work is not null, 1, 0)
        + iff(economic_impact_expectation is not null, 1, 0)
        + iff(government_action_suggestion is not null, 1, 0)
        + iff(personal_ai_impact is not null, 1, 0)
        + iff(availability_for_discussion is not null, 1, 0)
    ) as fields_completed_count
from extract_survey_responses
