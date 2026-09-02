with

seed as (
    select * from {{ source('FILE_DOWNLOADS', 'AI_POLICY_CONCEPTS_AND_THEMES') }}
)

select
    policy_concept,
    policy_concept_description,
    subtheme,
    theme
from seed
