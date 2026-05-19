with

ideas as (select * from TRANSFORM_ENGCA_PRD.govocal.stg_govocal_ideas),

regions as (select * from RAW_ENGCA_PRD.DEMOGRAPHICS.COUNTY_REGION_MAP),

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
),
-- noqa: enable=LT05


clean_response_values as (
    -- Go Vocal custom survey fields and user demographic fields are appended with 3 digit identifiers
    -- For example, 'woman' may be stored as 'woman_xyz'. These ids are removed and replaced with display-friendly text.
    select
        idea_id as survey_id,
        author_id as survey_respondent_id,
        published_at,
        submitted_at,
        publication_status,
        created_at,
        updated_at,
        href,
        custom_field_values,
        case left(current_work_status, length(current_work_status) - 4)
            when 'yes_i_currently_work' then 'Yes, I currently work'
            when
                'no_i_don_t_currently_work_but_i_m_looking_for_work'
                then 'No, I don''t currently work but I''m looking for work'
            when 'no_i_m_retired_or_choose_not_to_work' then 'No, I''m retired or choose not to work'
            when 'i_don_t_want_to_say' then 'I don''t want to say'
        end as current_work_status,
        case left(role_at_work, length(role_at_work) - 4)
            when 'employee_non_management' then 'Employee (non-management)'
            when 'manager' then 'Manager'
            when 'executive_or_leader' then 'Executive or leader'
            when 'business_owner_or_entrepreneur' then 'Business owner or entrepreneur'
            when 'contractor_freelancer_or_gig_worker' then 'Contractor, freelancer, or gig worker'
            when 'i_don_t_currently_work' then 'I don''t currently work'
            when 'i_don_t_want_to_say' then 'I don''t want to say'
        end as role_at_work,
        case left(county, length(county) - 4)
            when 'i_don_t_want_to_say' then 'I don''t want to say'
            when 'i_live_outside_of_california' then 'I live outside of California'
            else initcap(replace(left(county, length(county) - 4), '_', ' '))
        end as county,
        case left(field_of_work, length(field_of_work) - 4)
            when 'agriculture_forestry_or_fishing' then 'Agriculture, forestry, or fishing'
            when 'architecture_or_engineering' then 'Architecture or engineering'
            when 'arts_entertainment_or_media' then 'Arts, entertainment, or media'
            when 'corporate_ownership_or_governance' then 'Corporate ownership or governance'
            when 'i_don_t_currently_work' then 'I don''t currently work'
            when 'i_don_t_want_to_say' then 'I don''t want to say'
            when 'information_technology' then 'Information technology'
            when 'non_profit' then 'Non-profit'
            when 'real_estate_or_leasing' then 'Real estate or leasing'
            when 'retail_or_wholesale_trade' then 'Retail or wholesale trade'
            when 'transportation_or_warehousing' then 'Transportation or warehousing'
            when 'utilities_or_waste_management' then 'Utilities or waste management'
            else initcap(left(field_of_work, length(field_of_work) - 4))
        end as field_of_work,
        economic_impact_expectation,
        government_action_suggestion,
        personal_ai_impact,
        initcap(left(availability_for_discussion, length(availability_for_discussion) - 4))
            as availability_for_discussion

    from extract_survey_responses
),

add_sfc_count as (
    select
        *,
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
        ) as survey_fields_completed_count
    from clean_response_values
),

-- Add regions by looking up county responses in a county-region mapping table.
add_regions as (
    select
        s.*,
        regions.region
    from add_sfc_count as s
    left join regions on s.county = regions.county
)

select * from add_regions