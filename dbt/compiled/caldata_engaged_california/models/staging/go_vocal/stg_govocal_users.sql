with

users as (select * from RAW_ENGCA_PRD.GOVOCAL.USERS),

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
        custom_field_values:"what_is_your_gender_identity_lez"::array as gender_array,
        custom_field_values:"what_is_your_race_or_ethnicity_7mf"::array as race_ethnicity_array
    from users_convert_types
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
        case left(u.age, length(u.age) - 4)
            when 'under_18' then 'Under 18'
            when '18_24' then '18-24'
            when '25_44' then '25-44'
            when '45_64' then '45-64'
            when 'over_65' then 'Over 65'
            when 'i_don_t_want_to_say' then 'I don''t want to say'
        end as age,
        transform(
            u.gender_array, val varchar ->
            case left(val, length(val) - 4)
                when 'man' then 'Man'
                when 'woman' then 'Woman'
                when
                    'another_gender_identity_like_transgender_non_binary_or_gender_non_conforming'
                    then 'Another gender identity (like transgender, non-binary, or gender non-conforming)'
                when 'i_don_t_want_to_say' then 'I don''t want to say'
            end
        ) as gender_array,
        transform(
            u.race_ethnicity_array, val varchar ->
            case left(val, length(val) - 4)
                when 'american_indian_or_alaska_native' then 'American Indian or Alaska Native'
                when 'asian' then 'Asian'
                when 'black_or_african_american' then 'Black or African American'
                when 'hispanic_or_latino' then 'Hispanic or Latino'
                when 'middle_eastern_or_north_african' then 'Middle Eastern or North African'
                when 'native_hawaiian_or_pacific_islander' then 'Native Hawaiian or Pacific Islander'
                when 'white' then 'White'
            end
        ) as race_ethnicity_array,
        u.user_status,
        u.created_at,
        u.updated_at,
        u._load_date,
        u._loaded_at

    from users_extract_demographics as u
)

select * from users_demographics