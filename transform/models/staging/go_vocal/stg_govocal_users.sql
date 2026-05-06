with

users as (select * from {{ source('GOVOCAL', 'USERS') }}),

users_convert_types as (
    select
        id as user_id,
        email,
        slug,
        try_parse_json(roles) as roles,
        first_name,
        last_name,
        locale,
        bio,
        registration_completed_at::timestamp_ltz as registration_completed_at,
        verified,
        email_confirmed_at::timestamp_ltz as email_confirmed_at,
        email_confirmation_code_sent_at::timestamp_ltz as email_confirmation_code_sent_at,
        confirmation_required,
        try_parse_json(custom_field_values) as custom_field_values,
        status as user_status,
        created_at::timestamp_ltz as created_at,
        updated_at::timestamp_ltz as updated_at,
        _load_date,
        _loaded_at
    from users
),

users_extract_demographics as (
    select
        *,
        -- Extract demographic information from custom field values
        custom_field_values:"what_is_your_age_t0m"::string as age,
        custom_field_values:"what_is_your_gender_identity_lez"::array as gender,
        custom_field_values:"what_is_your_race_or_ethnicity_7mf"::array as race_ethnicity
    from users_convert_types
),

gen as (
    select
        ued.user_id,
        array_agg(
            left(f.value::string, length(f.value::string) - 4)
        ) as gender_array
    from users_extract_demographics as ued,
        lateral flatten(input => ued.gender) as f
    group by ued.user_id
),

re as (
    select
        ued.user_id,
        array_agg(
            left(f.value::string, length(f.value::string) - 4)
        ) as race_ethnicity_array
    from users_extract_demographics as ued,
        lateral flatten(input => ued.race_ethnicity) as f
    group by ued.user_id
),

users_demographics as (

    select
        u.user_id,
        u.email,
        u.slug,
        u.roles,
        array_size(filter(u.roles, r -> r:"type"::string = 'admin')) > 0 as is_admin,
        u.first_name,
        u.last_name,
        u.locale,
        u.bio,
        u.registration_completed_at,
        u.verified,
        u.email_confirmed_at,
        u.email_confirmation_code_sent_at,
        u.confirmation_required,
        u.custom_field_values,
        left(u.age, length(u.age) - 4) as age,
        gen.gender_array,
        re.race_ethnicity_array,
        u.user_status,
        u.created_at,
        u.updated_at,
        u._load_date,
        u._loaded_at

    from users_extract_demographics as u
    left join gen
        on u.user_id = gen.user_id
    left join re
        on u.user_id = re.user_id
)

select * from users_demographics
