WITH survey_responses AS (
    -- Upstream staging model containing cleaned survey data
    SELECT * FROM TRANSFORM_ENGCA_PRD.ethelo.stg_survey
),

race_flags AS (
    -- Generate binary flags for each race/ethnicity category per participant
    -- Simplifies checking multiple conditions (detailed category OR write-in)
    SELECT
        participant_id,
        -- Check if any response indicates this category was selected
        (ai_an_writein IS NOT NULL) AS flag_american_indian_or_alaska_native,
        (asian_detailed IS NOT NULL OR asian_writein IS NOT NULL) AS flag_asian,
        (black_detailed IS NOT NULL OR black_writein IS NOT NULL) AS flag_black_or_african_american,
        (hisp_latino_detailed IS NOT NULL OR hisp_latino_writein IS NOT NULL) AS flag_hispanic_or_latino,
        (mena_detailed IS NOT NULL OR mena_writein IS NOT NULL) AS flag_middle_eastern_or_north_african,
        (nhpi_detailed IS NOT NULL OR nhpi_writein IS NOT NULL) AS flag_native_hawaiian_or_pacific_islander,
        (white_detailed IS NOT NULL OR white_writein IS NOT NULL) AS flag_white
    FROM survey_responses
),

long_format AS (
    -- Unpivot the flags: create one row per participant per selected race/ethnicity
    -- This allows easy grouping by the race_ethnicity string later.
    -- Note: Participants selecting multiple categories will appear multiple times.
    SELECT
        participant_id,
        'American Indian or Alaska Native' AS race_ethnicity
    FROM race_flags
    WHERE flag_american_indian_or_alaska_native
    UNION ALL
    SELECT
        participant_id,
        'Asian' AS race_ethnicity
    FROM race_flags
    WHERE flag_asian
    UNION ALL
    SELECT
        participant_id,
        'Black or African American' AS race_ethnicity
    FROM race_flags
    WHERE flag_black_or_african_american
    UNION ALL
    SELECT
        participant_id,
        'Hispanic or Latino' AS race_ethnicity
    FROM race_flags
    WHERE flag_hispanic_or_latino
    UNION ALL
    SELECT
        participant_id,
        'Middle Eastern or North African' AS race_ethnicity
    FROM race_flags
    WHERE flag_middle_eastern_or_north_african
    UNION ALL
    SELECT
        participant_id,
        'Native Hawaiian or Pacific Islander' AS race_ethnicity
    FROM race_flags
    WHERE flag_native_hawaiian_or_pacific_islander
    UNION ALL
    SELECT
        participant_id,
        'White' AS race_ethnicity
    FROM race_flags
    WHERE flag_white
),

totals AS (
    -- Calculate overall denominators needed for percentage calculations
    SELECT
        COUNT(DISTINCT participant_id) AS total_participants,
        -- Count distinct participants who selected at least one race/ethnicity flag
        COUNT(DISTINCT CASE
            WHEN
                flag_american_indian_or_alaska_native OR flag_asian OR flag_black_or_african_american
                OR flag_hispanic_or_latino OR flag_middle_eastern_or_north_african
                OR flag_native_hawaiian_or_pacific_islander OR flag_white
                THEN participant_id
        END) AS total_with_race_response
    FROM race_flags
)

-- Final aggregation to get counts and percentages per category
SELECT
    lf.race_ethnicity,
    COUNT(DISTINCT lf.participant_id) AS num_participants,
    -- Calculate % of all participants (handle potential division by zero)
    ROUND(100.0 * COUNT(DISTINCT lf.participant_id) / NULLIF(t.total_participants, 0), 1)
        AS percent_of_all_participants,
    -- Calculate % of participants who responded to the race question (handle potential division by zero)
    ROUND(100.0 * COUNT(DISTINCT lf.participant_id) / NULLIF(t.total_with_race_response, 0), 1)
        AS percent_of_re_respondents
FROM long_format AS lf
CROSS JOIN totals AS t
GROUP BY
    lf.race_ethnicity,
    t.total_participants,
    t.total_with_race_response
ORDER BY
    num_participants DESC