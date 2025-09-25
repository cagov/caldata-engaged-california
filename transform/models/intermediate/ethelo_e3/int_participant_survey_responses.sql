{{ config(
    materialized='table'
) }}

-- Pivoted survey responses for E3 participants
-- This intermediate table can be reused across multiple marts

select
    participant_id,
    max(
        case
            when question = 'Opening question - What makes you proud about your role in public service?' then answer
        end
    ) as point_of_pride,
    listagg(
        distinct
        case when question = 'Share your idea - Which department or agency does your idea apply to?' then answer end,
        ', '
    ) as idea_dept,
    max(case when question = 'About you - Position type' then answer end) as pos_type,
    max(case when question = 'About you - How long have you worked for the State of California?' then answer end)
        as ca_tenure,
    max(response_date) as last_survey_response_date,
    max(_file_upload_date) as _file_upload_date
from {{ ref('stg_ethelo_e3_survey') }}
where
    question in (
        'Opening question - What makes you proud about your role in public service?',
        'Share your idea - Which department or agency does your idea apply to?',
        'About you - Position type',
        'About you - How long have you worked for the State of California?'
    )
    and response_date >= '2025-08-15'
group by participant_id
