with

seed as (
    select * from {{ ref('ai_policy_concepts_and_themes') }}
)

select
    policy_concept,
    policy_concept_description,
    subtheme,
    theme
from seed
