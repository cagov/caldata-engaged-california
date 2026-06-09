WITH respondents as ( 
    select survey_respondent_id,
    economic_impact_expectation 
   , personal_ai_impact 
   , government_action_suggestion 
   from {{ ref('int_govocal_users_x_ai_survey') }}
    where survey_respondent_id is not null
    and publication_status = 'published'
),

--the seed referenced here includes the exemplars used to calibrate the LLM's classifications.
--these exemplars were identified during the initial classification process, and were sanity checked
--by humans.
--we join to the respondents table to populate the full response data for each exemplar.
exemplars as ( select
    listagg(
             'Response: "[Economic] ' || coalesce(r.economic_impact_expectation, '(none)')
            || ' [Personal] '  || coalesce(r.personal_ai_impact, '(none)')
            || ' [Government] ' || coalesce(r.government_action_suggestion, '(none)') || '" '
            || '{"label": "' || e.label || '", "rationale": "' || e.rationale || '"} ',
            ' '
        ) within group (order by e.label) as exemplar_block
    from {{ ref('ai_response_label_exemplars') }} e
    join respondents r on e.survey_respondent_id = r.survey_respondent_id
)

select exemplar_block from exemplars