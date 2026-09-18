-- Extract and clean race/ethnicity values from survey responses
WITH race_ethnicity_data AS (
    SELECT
        participant_id,
        TRIM(REPLACE(
            REPLACE(question, 'Demographics - Race and/or Ethnicity - ', ''),
            ' - First level category', ''
        )) AS race_ethnicity_value
    FROM TRANSFORM_ENGCA_PRD.ethelo_la_deliberation.stg_ethelo_la_deliberation_survey
    WHERE question LIKE 'Demographics - Race and/or Ethnicity -%'
),

-- Count non-"I'd rather not say" responses per participant
race_ethnicity_counts AS (
    SELECT
        participant_id,
        race_ethnicity_value,
        COUNT(CASE WHEN race_ethnicity_value != 'I''d rather not say' THEN 1 END)
            OVER (PARTITION BY participant_id) AS other_values_count
    FROM race_ethnicity_data
),

-- Aggregate race/ethnicity into arrays per participant
race_ethnicity_final AS (
    SELECT
        participant_id,
        ARRAY_SORT(
            ARRAY_UNIQUE_AGG(
                DISTINCT
                CASE
                    WHEN race_ethnicity_value = 'I''d rather not say' AND other_values_count > 0
                        THEN NULL  -- Exclude "I'd rather not say" if other values present
                    ELSE race_ethnicity_value
                END
            )
        ) AS race_ethnicity_array
    FROM race_ethnicity_counts
    GROUP BY participant_id
),

-- Pivot other demographic questions
other_demographics AS (
    SELECT *
    FROM (
        SELECT
            participant_id,
            answer,
            question
        FROM TRANSFORM_ENGCA_PRD.ethelo_la_deliberation.stg_ethelo_la_deliberation_survey
        WHERE question NOT LIKE 'Demographics - Race and/or Ethnicity -%'
    )
    PIVOT (
        MAX(answer) FOR question IN (
            'Demographics - Income',
            'Demographics - Age',
            'Demographics - Gender identity',
            'Final thoughts - Did taking the survey increase your confidence in Los Angeles fires recovery efforts, in general?',-- noqa: LT05
            'Demographics - Evacuation zone',
            'Final thoughts - How do you feel about the community’s top recovery options as they stand now?',
            'Opening questions - How would you describe your overall outlook on Los Angeles''s recovery from the wildfires?',-- noqa: LT05
            'Final thoughts - Share more about your general outlook on fires recovery'
        )
    ) AS p (
        participant_id,
        income,
        age,
        gender_identity,
        confidence_increase,
        evacuation_zone,
        recovery_options_feeling,
        opening_outlook,
        final_outlook
    )
)

-- Join race/ethnicity data with other demographics
SELECT
    COALESCE(r.participant_id, o.participant_id) AS participant_id,
    r.race_ethnicity_array,
    o.income,
    o.age,
    o.gender_identity,
    o.confidence_increase,
    o.evacuation_zone,
    o.recovery_options_feeling,
    o.opening_outlook,
    o.final_outlook
FROM race_ethnicity_final AS r
FULL OUTER JOIN other_demographics AS o
    ON r.participant_id = o.participant_id
ORDER BY participant_id