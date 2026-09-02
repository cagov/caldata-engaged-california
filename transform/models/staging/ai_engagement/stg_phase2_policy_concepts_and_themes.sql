with

source as (
    select * from {{ source('FILE_DOWNLOADS', 'AI_POLICY_CONCEPTS_AND_THEMES') }}
)

select
    row_number() over (order by theme, subtheme, policy_concept) as policy_concept_id,
    policy_concept,
    policy_concept_description,
    subtheme,
    theme
from source
