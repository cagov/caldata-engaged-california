{{ config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key='survey_respondent_id',
    on_schema_change='sync_all_columns'
) }} 

-- This model runs incrementally to only process new data, since this model includes LLM classification, which can be costly to run on the entire dataset every time. 
-- The unique key is survey_respondent_id, since each respondent should only have one set of responses to classify. 
-- The incremental strategy is merge, which allows us to update existing records if needed and insert new records.


WITH 
--the seed referenced here includes the exemplars used to calibrate the LLM's classifications.
--these exemplars were identified during the initial classification process, and were sanity checked
--by humans.
--we join to the respondents table to populate the full response data for each exemplar.
exemplars as ( select
    exemplar_block
    from {{ ref('int_govocal_ai_response_exemplars') }}
),

-- only the ones we need to classify this run (survey respondent hasn't already been labelled)
responses_to_classify as (
    SELECT
        survey_respondent_id,
        TRIM(COALESCE(ECONOMIC_IMPACT_EXPECTATION, '')) as economic_impact_expectation_trimmed,
        TRIM(COALESCE(GOVERNMENT_ACTION_SUGGESTION, '')) as government_action_suggestion_trimmed,
        TRIM(COALESCE(PERSONAL_AI_IMPACT, '')) as personal_ai_impact_trimmed
    FROM {{ ref('int_govocal_users_x_ai_survey') }}
    WHERE 1=1
        {% if is_incremental() %}
            and survey_respondent_id not in (
                select survey_respondent_id from {{ this }}
            )
        {% endif %}
),


classified AS (
    SELECT
        r.SURVEY_RESPONDENT_ID,
        CASE
            WHEN r.economic_impact_expectation_trimmed != ''
              OR r.personal_ai_impact_trimmed != ''
              OR r.government_action_suggestion_trimmed != ''
            THEN SNOWFLAKE.CORTEX.COMPLETE(
                '{{ var("llm_model") }}',
                ARRAY_CONSTRUCT(
                    OBJECT_CONSTRUCT('role', 'system', 'content', 
                    'You are classifying California residents'' survey responses about AI. Classify the respondent''s policy position and attitude toward AI as a technology —'
                    || 'not the emotional tone of their writing.'
                    
                    || 'POS: The respondent views AI as broadly beneficial or more beneficial than harmful and supports its development,'
                    || 'adoption, or expansion. They may also desire less or light government regulation of AI, or greater public investment in AI development.'
                    
                    || 'NEG: The respondent views AI as broadly harmful or more harmful than good and opposes its development, adoption, or expansion.'
                    || 'They may also desire greater government regulation of AI, or divestment from and restrictions on AI development.'

                    || 'MIX: The respondent is ambivalent, does not express a clear directional stance, or expresses'
                    || 'views that are both strongly pro- or strongly anti-. They may have mixed or uncertain feelings about how the government should deal with AI, or only express'
                    || 'a positive outlook if the government can satisfactorily oversee it.'

                    || 'EXAMPLES (use these as calibration references): '
                    || e.exemplar_block
                    ),
                    
                     OBJECT_CONSTRUCT('role', 'user', 'content', CONCAT(
                            'Economic impact: ',          coalesce(r.economic_impact_expectation_trimmed, '(none)'),
                            ' | Personal AI impact: ',    coalesce(r.personal_ai_impact_trimmed, '(none)'),
                            ' | Government action suggestion: ', coalesce(r.government_action_suggestion_trimmed, '(none)')
                ))
                ),
                OBJECT_CONSTRUCT('temperature', 0, 'max_tokens', 150)


            )
        END AS ai_response_raw
    FROM responses_to_classify r
    cross join exemplars e

)

select * from classified

parsed AS (
    SELECT
        SURVEY_RESPONDENT_ID,
        TRY_PARSE_JSON(
            ai_response_raw:choices[0]:messages::VARCHAR
        ) AS ai_response_json
    FROM classified
)

SELECT
    SURVEY_RESPONDENT_ID,
    ai_response_json:label::VARCHAR     AS ai_response_label,
    ai_response_json:rationale::VARCHAR AS ai_response_rationale
FROM parsed
