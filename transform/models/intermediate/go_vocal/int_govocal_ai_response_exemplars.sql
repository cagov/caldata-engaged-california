WITH respondents AS (
    SELECT
        survey_respondent_id,
        economic_impact_expectation,
        personal_ai_impact,
        government_action_suggestion
    FROM {{ ref('int_govocal_users_x_ai_survey') }}
    WHERE
        survey_respondent_id IS NOT null
        AND publication_status = 'published'
),

--the seed referenced here includes the exemplars used to calibrate the LLM's classifications.
--these exemplars were identified during the initial classification process, and were sanity checked
--by humans.
--we join to the respondents table to populate the full response data for each exemplar.
exemplars AS (
    SELECT
        listagg(
            'Response: "[Economic] ' || coalesce(r.economic_impact_expectation, '(none)')
            || ' [Personal] ' || coalesce(r.personal_ai_impact, '(none)')
            || ' [Government] ' || coalesce(r.government_action_suggestion, '(none)') || '" '
            || '{"label": "' || e.label || '", "rationale": "' || e.rationale || '"} ',
            ' '
        ) WITHIN GROUP (ORDER BY e.label) AS exemplar_block
    FROM {{ ref('ai_response_label_exemplars') }} AS e
    INNER JOIN respondents AS r ON e.survey_respondent_id = r.survey_respondent_id
)

SELECT exemplar_block FROM exemplars
