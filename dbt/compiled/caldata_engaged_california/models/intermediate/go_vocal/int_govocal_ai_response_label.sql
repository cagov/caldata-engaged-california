

-- This model runs incrementally to only process new data, since this model includes LLM classification,
-- which can be costly to run on the entire dataset every time.
-- The unique key is survey_respondent_id, since each respondent should only have one set of responses to classify.
-- The incremental strategy is merge, which allows us to update existing records if needed and insert new records.


WITH
--this is a pre-formmated block of text that includes exemplar responses that were used to calibrate
--the LLM's classifications.
--These exemplars were identified during the initial classification process, and were sanity checked by humans.
exemplars AS (
    SELECT exemplar_block
    FROM TRANSFORM_ENGCA_PRD.govocal.int_govocal_ai_response_exemplars
),


-- only the ones we need to classify this run (survey respondent hasn't already been labelled)

-- noqa: disable=LT02
-- the `is_incremental()` causes issues with the linter. Disabling indentation QA for this CTE only.
responses_to_classify AS (
    SELECT
        r.survey_respondent_id,
        TRIM(COALESCE(r.economic_impact_expectation, '')) AS economic_impact_expectation_trimmed,
        TRIM(COALESCE(r.government_action_suggestion, '')) AS government_action_suggestion_trimmed,
        TRIM(COALESCE(r.personal_ai_impact, '')) AS personal_ai_impact_trimmed

    FROM TRANSFORM_ENGCA_PRD.govocal.int_govocal_users_x_ai_survey AS r
    WHERE
        r.survey_respondent_id IS NOT null
        AND r.publication_status = 'published'
        AND (r.economic_impact_expectation != '' OR r.personal_ai_impact != '' OR r.government_action_suggestion != '')
        
            AND (
                r.survey_respondent_id NOT IN (
                    SELECT t.survey_respondent_id FROM TRANSFORM_ENGCA_PRD.govocal.int_govocal_ai_response_label AS t
                )
                OR r.survey_respondent_id IN (
                    SELECT s.survey_respondent_id FROM TRANSFORM_ENGCA_PRD.govocal.int_govocal_ai_response_label AS s
                    WHERE s.ai_response_label IS null
                )
            )
        
),

-- noqa: enable=LT02
classified AS (
    SELECT
        r.survey_respondent_id,
        CASE
            WHEN
                r.economic_impact_expectation_trimmed != ''
                OR r.personal_ai_impact_trimmed != ''
                OR r.government_action_suggestion_trimmed != ''
                THEN SNOWFLAKE.CORTEX.COMPLETE(
                    'claude-opus-4-8',
                    ARRAY_CONSTRUCT(
                        OBJECT_CONSTRUCT(
                            'role', 'system', 'content',
                            'You are classifying California residents'' survey responses about AI.'
                            || 'Classify the respondent''s policy'
                            || 'position and attitude toward AI as a technology —'
                            || 'not the emotional tone of their writing.'

                            || 'POS: The respondent views AI as broadly beneficial or more'
                            || 'beneficial than harmful and supports'
                            || 'its development, adoption, or expansion. They may also desire'
                            || 'less or light government regulation'
                            || 'of AI, or greater public investment in AI development.'

                            || 'NEG: The respondent views AI as broadly harmful or more harmful'
                            || 'than good and opposes its development'
                            || 'adoption, or expansion. They may also desire greater government'
                            || 'regulation of AI, or divestment from'
                            || 'and restrictions on AI development.'

                            || 'MIX: The respondent is ambivalent, does not express a clear'
                            || 'directional stance, or expresses'
                            || 'views that are both strongly pro- or strongly anti-. They may have'
                            || 'mixed or uncertain feelings about'
                            || 'how the government should deal with AI, or only express'
                            || 'a positive outlook if the government can satisfactorily oversee it.'

                            || 'Respond with JSON only, no markdown:'
                            || '{"label": "pro|anti|neutral", "rationale": "one sentence"}'
                            || 'EXAMPLES (use these as calibration references): '
                            || e.exemplar_block
                        ),

                        OBJECT_CONSTRUCT('role', 'user', 'content', CONCAT(
                            'Economic impact: ', COALESCE(r.economic_impact_expectation_trimmed, '(none)'),
                            ' | Personal AI impact: ', COALESCE(r.personal_ai_impact_trimmed, '(none)'),
                            ' | Government action suggestion: ',
                            COALESCE(r.government_action_suggestion_trimmed, '(none)')
                        ))
                    ),
                    OBJECT_CONSTRUCT('temperature', 0, 'max_tokens', 150)


                )
        END AS ai_response_raw
    FROM responses_to_classify AS r
    CROSS JOIN exemplars AS e

),

parsed AS (
    SELECT
        survey_respondent_id,
        TRY_PARSE_JSON(
            REGEXP_SUBSTR(
                ai_response_raw:choices[0]:messages::VARCHAR,
                '\\{[^}]+\\}'
            )
        ) AS ai_response_json
    FROM classified
)

SELECT
    survey_respondent_id,
    ai_response_json:label::VARCHAR AS ai_response_label,
    ai_response_json:rationale::VARCHAR AS ai_response_rationale
FROM parsed