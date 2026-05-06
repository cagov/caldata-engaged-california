-- This model joins user data with AI Survey data to calculate the count of Go Vocal users by various demographic
-- and survey response fields.

{% set total_survey_fields = 11 %}

with

survey as (select * from {{ ref('int_govocal_ai_survey') }}),

users as (select * from {{ ref('stg_govocal_users') }}),

non_admin_users as (
    select *
    from users
    where is_admin = FALSE
),

count_specific_demographic_fields as (
    select
        *,
        iff(age is not NULL, 1, 0)
        + iff(array_size(gender_array) > 0, 1, 0)
        + iff(array_size(race_ethnicity_array) > 0, 1, 0)
            as demographic_fields_completed_count
    from non_admin_users
),

handle_multiselect_arrays as (
    select
        *,

        -- if array size is 1, then extract the value from the array as a string, if the array size is >1,
        -- then return the string 'multiple', if the array size is 0, return null
        case array_size(gender_array)
            when 0 then NULL
            when 1 then gender_array[0]
            else 'multiple'
        end as gender,

        case array_size(race_ethnicity_array)
            when 0 then NULL
            when 1 then race_ethnicity_array[0]
            else 'multiple'
        end as race_ethnicity

    from count_specific_demographic_fields
),

counts as (
    select
        s.role_at_work,
        s.county,
        s.field_of_work,
        u.age,
        u.gender,
        u.race_ethnicity,

        count(distinct u.user_id) as gv_users_count,
        count(distinct s.author_id) as respondents_count,
        count(distinct case when s.publication_status = 'published' then s.author_id end) as submitted_count,
        count(distinct case when s.publication_status = 'draft' then s.author_id end) as drafts_count,
        count(distinct case when s.availability_for_discussion in ('yes', 'maybe') then s.author_id end)
            as available_for_discussion_count,
        count(
            distinct case
                when
                    s.fields_completed_count + u.demographic_fields_completed_count = {{ total_survey_fields }}
                    then s.author_id
            end
        ) as all_fields_completed_count

    from handle_multiselect_arrays as u
    left join survey as s on u.user_id = s.author_id
    group by
        s.role_at_work,
        s.county,
        s.field_of_work,
        u.age,
        u.gender,
        u.race_ethnicity
)

select * from counts
