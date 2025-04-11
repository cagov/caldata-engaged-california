WITH survey_responses AS (
    -- Upstream staging model containing cleaned survey data
    SELECT * FROM {{ ref('stg_survey') }}
),

race_flags AS (
    -- Generate binary flags for each race/ethnicity category per participant
    -- Simplifies checking multiple conditions (detailed category OR write-in)
    SELECT
        PARTICIPANT_ID,
        -- Check if any response indicates this category was selected
        CASE WHEN AI_AN_WRITEIN IS NOT NULL THEN 1 ELSE 0 END AS flag_american_indian_or_alaska_native,
        CASE WHEN ASIAN_DETAILED IS NOT NULL OR ASIAN_WRITEIN IS NOT NULL THEN 1 ELSE 0 END AS flag_asian,
        CASE WHEN BLACK_DETAILED IS NOT NULL OR BLACK_WRITEIN IS NOT NULL THEN 1 ELSE 0 END AS flag_black_or_african_american,
        CASE WHEN HISP_LATINO_DETAILED IS NOT NULL OR HISP_LATINO_WRITEIN IS NOT NULL THEN 1 ELSE 0 END AS flag_hispanic_or_latino,
        CASE WHEN MENA_DETAILED IS NOT NULL OR MENA_WRITEIN IS NOT NULL THEN 1 ELSE 0 END AS flag_middle_eastern_or_north_african,
        CASE WHEN NHPI_DETAILED IS NOT NULL OR NHPI_WRITEIN IS NOT NULL THEN 1 ELSE 0 END AS flag_native_hawaiian_or_pacific_islander,
        CASE WHEN WHITE_DETAILED IS NOT NULL OR WHITE_WRITEIN IS NOT NULL THEN 1 ELSE 0 END AS flag_white
    FROM survey_responses
),

long_format AS (
    -- Unpivot the flags: create one row per participant per selected race/ethnicity
    -- This allows easy grouping by the race_ethnicity string later.
    -- Note: Participants selecting multiple categories will appear multiple times.
    SELECT PARTICIPANT_ID, 'American Indian or Alaska Native' AS race_ethnicity FROM race_flags WHERE flag_american_indian_or_alaska_native = 1
    UNION ALL
    SELECT PARTICIPANT_ID, 'Asian' FROM race_flags WHERE flag_asian = 1
    UNION ALL
    SELECT PARTICIPANT_ID, 'Black or African American' FROM race_flags WHERE flag_black_or_african_american = 1
    UNION ALL
    SELECT PARTICIPANT_ID, 'Hispanic or Latino' FROM race_flags WHERE flag_hispanic_or_latino = 1
    UNION ALL
    SELECT PARTICIPANT_ID, 'Middle Eastern or North African' FROM race_flags WHERE flag_middle_eastern_or_north_african = 1
    UNION ALL
    SELECT PARTICIPANT_ID, 'Native Hawaiian or Pacific Islander' FROM race_flags WHERE flag_native_hawaiian_or_pacific_islander = 1
    UNION ALL
    SELECT PARTICIPANT_ID, 'White' FROM race_flags WHERE flag_white = 1
),

totals AS (
    -- Calculate overall denominators needed for percentage calculations
    SELECT
        COUNT(DISTINCT PARTICIPANT_ID) AS total_participants,
        -- Count distinct participants who selected at least one race/ethnicity flag
        COUNT(DISTINCT CASE
            WHEN flag_american_indian_or_alaska_native = 1 OR flag_asian = 1 OR flag_black_or_african_american = 1 OR
                 flag_hispanic_or_latino = 1 OR flag_middle_eastern_or_north_african = 1 OR
                 flag_native_hawaiian_or_pacific_islander = 1 OR flag_white = 1
            THEN PARTICIPANT_ID
        END) AS total_with_race_response
    FROM race_flags
)

-- Final aggregation to get counts and percentages per category
SELECT
    lf.race_ethnicity,
    COUNT(DISTINCT lf.PARTICIPANT_ID) AS num_participants,
    -- Calculate % of all participants (handle potential division by zero)
    ROUND(100.0 * COUNT(DISTINCT lf.PARTICIPANT_ID) / NULLIF(t.total_participants, 0), 1) AS percent_of_all_participants,
    -- Calculate % of participants who responded to the race question (handle potential division by zero)
    ROUND(100.0 * COUNT(DISTINCT lf.PARTICIPANT_ID) / NULLIF(t.total_with_race_response, 0), 1) AS percent_of_re_respondents
FROM long_format lf
CROSS JOIN totals t
GROUP BY
    lf.race_ethnicity,
    t.total_participants, -- Need to group by denominator cols used in SELECT
    t.total_with_race_response
ORDER BY
    num_participants DESC
