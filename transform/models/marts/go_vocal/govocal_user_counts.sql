with

survey as (select * from {{ ref('int_govocal_ai_survey') }}),

users as (select * from {{ ref('stg_govocal_users') }}),

non_admin_users as (
    select *
    from users
    where is_admin = FALSE
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

    from non_admin_users
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
        -- all_fields_completed_count doesn't include the user based demographic fields
        count(distinct case when s.fields_completed_count = 8 then s.author_id end) as all_fields_completed_count

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
