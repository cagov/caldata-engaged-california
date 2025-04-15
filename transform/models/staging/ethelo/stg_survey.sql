WITH participants AS (
    SELECT *
    FROM {{ ref('stg_participants') }}
),

final AS (
    SELECT
        a.influence AS influence_level,
        a.participant AS participant_id,
        a.joined_date AS survey_join_date,
        a.civility_pledge AS civility_pledge_status,
        a.topic_themes AS discussion_topics,
        a.what_is_your_perspective_on_la_s_recovery_ AS la_recovery_perspective,
        a.your_views AS additional_views,
        a.if_you_had_a_home_or_business_damaged_or_lost_or_lost_employment_or_income_to_the_recent_fires_in_la_select_the_zip_code_of_that_home_business_or_place_of_employment_ -- noqa: L016
            AS fire_impacted_zip,
        REGEXP_SUBSTR(
            a.if_you_had_a_home_or_business_damaged_or_lost_or_lost_employment_or_income_to_the_recent_fires_in_la_select_the_zip_code_of_that_home_business_or_place_of_employment_, -- noqa: L016
            '\\b\\d{5}\\b'
        ) AS fire_impacted_zip_clean,
        a.what_must_be_addressed_first_to_ensure_a_successful_recovery_ AS recovery_priority,

        NULLIF(a.american_indian_or_alaska_native_write_in, '') AS ai_an_writein,
        NULLIF(a.terms_i_agree_to_the_moderation_policy, '') AS moderation_policy_agreement,
        NULLIF(a.are_you_a_homeowner_renter_or_unhoused_, '') AS housing_status,
        NULLIF(a.are_you_unemployed_or_underemployed_as_a_result_of_the_la_fires_, '') AS fire_impact_employment,
        NULLIF(a.asian_detailed_categories, '') AS asian_detailed,
        NULLIF(a.what_was_your_household_income_before_taxes_last_year_, '') AS household_income_pretax,
        NULLIF(a.asian_write_in, '') AS asian_writein,
        NULLIF(a.black_or_african_american_detailed_categories, '') AS black_detailed,
        NULLIF(a.black_or_african_american_write_in, '') AS black_writein,
        NULLIF(a.hispanic_or_latino_detailed_categories, '') AS hisp_latino_detailed,
        NULLIF(a.hispanic_or_latino_write_in, '') AS hisp_latino_writein,
        NULLIF(a.middle_eastern_or_north_african_detailed_categories, '') AS mena_detailed,
        NULLIF(a.middle_eastern_or_north_african_write_in, '') AS mena_writein,
        NULLIF(a.native_hawaiian_or_pacific_islander_detailed_categories, '') AS nhpi_detailed,
        NULLIF(a.native_hawaiian_or_pacific_islander_write_in, '') AS nhpi_writein,
        NULLIF(a.white_detailed_categories, '') AS white_detailed,
        NULLIF(a.white_write_in, '') AS white_writein,

        CASE
            WHEN
                ( -- AI/AN
                    CASE
                        WHEN
                            a.american_indian_or_alaska_native_write_in IS NOT NULL
                            AND a.american_indian_or_alaska_native_write_in != ''
                            THEN 1
                        ELSE 0
                    END
                )
                + ( -- Asian
                    CASE
                        WHEN
                            a.asian_detailed_categories IS NOT NULL
                            OR (a.asian_write_in IS NOT NULL AND a.asian_write_in != '')
                            THEN 1
                        ELSE 0
                    END
                )
                + ( -- Black
                    CASE
                        WHEN
                            a.black_or_african_american_detailed_categories IS NOT NULL -- noqa: L016
                            OR (
                                a.black_or_african_american_write_in IS NOT NULL
                                AND a.black_or_african_american_write_in != ''
                            )
                            THEN 1
                        ELSE 0
                    END
                )
                + ( -- Hispanic/Latino
                    CASE
                        WHEN
                            (
                                a.hispanic_or_latino_detailed_categories IS NOT NULL
                                AND a.hispanic_or_latino_detailed_categories != ''
                            )
                            OR (
                                a.hispanic_or_latino_write_in IS NOT NULL
                                AND a.hispanic_or_latino_write_in != ''
                            )
                            THEN 1
                        ELSE 0
                    END
                )
                + ( -- MENA
                    CASE
                        WHEN
                            a.middle_eastern_or_north_african_detailed_categories IS NOT NULL -- noqa: L016
                            OR (
                                a.middle_eastern_or_north_african_write_in IS NOT NULL
                                AND a.middle_eastern_or_north_african_write_in != ''
                            )
                            THEN 1
                        ELSE 0
                    END
                )
                + ( -- NHPI
                    CASE
                        WHEN
                            a.native_hawaiian_or_pacific_islander_detailed_categories IS NOT NULL -- noqa: L016
                            OR (
                                a.native_hawaiian_or_pacific_islander_write_in IS NOT NULL
                                AND a.native_hawaiian_or_pacific_islander_write_in != ''
                            )
                            THEN 1
                        ELSE 0
                    END
                )
                + ( -- White
                    CASE
                        WHEN
                            a.white_detailed_categories IS NOT NULL
                            OR (a.white_write_in IS NOT NULL AND a.white_write_in != '')
                            THEN 1
                        ELSE 0
                    END
                )
                > 1 THEN 'Multi-Race'
            WHEN
                a.american_indian_or_alaska_native_write_in IS NOT NULL
                AND a.american_indian_or_alaska_native_write_in != ''
                THEN 'American Indian or Alaska Native'
            WHEN
                a.asian_detailed_categories IS NOT NULL
                OR (a.asian_write_in IS NOT NULL AND a.asian_write_in != '')
                THEN 'Asian'
            WHEN
                a.black_or_african_american_detailed_categories IS NOT NULL
                OR (
                    a.black_or_african_american_write_in IS NOT NULL
                    AND a.black_or_african_american_write_in != ''
                )
                THEN 'Black or African American'
            WHEN
                (
                    a.hispanic_or_latino_detailed_categories IS NOT NULL
                    AND a.hispanic_or_latino_detailed_categories != ''
                )
                OR (
                    a.hispanic_or_latino_write_in IS NOT NULL
                    AND a.hispanic_or_latino_write_in != ''
                )
                THEN 'Hispanic or Latino'
            WHEN
                a.middle_eastern_or_north_african_detailed_categories IS NOT NULL
                OR (
                    a.middle_eastern_or_north_african_write_in IS NOT NULL
                    AND a.middle_eastern_or_north_african_write_in != ''
                )
                THEN 'Middle Eastern or North African'
            WHEN
                a.native_hawaiian_or_pacific_islander_detailed_categories IS NOT NULL
                OR (
                    a.native_hawaiian_or_pacific_islander_write_in IS NOT NULL
                    AND a.native_hawaiian_or_pacific_islander_write_in != ''
                )
                THEN 'Native Hawaiian or Pacific Islander'
            WHEN
                a.white_detailed_categories IS NOT NULL
                OR (a.white_write_in IS NOT NULL AND a.white_write_in != '')
                THEN 'White'
        END AS race_ethnicity

    FROM {{ source('ETHELO', 'SURVEY_BY_EMAIL') }} AS a
    INNER JOIN participants AS b ON a.participant = b.participant_id
)

SELECT * FROM final
