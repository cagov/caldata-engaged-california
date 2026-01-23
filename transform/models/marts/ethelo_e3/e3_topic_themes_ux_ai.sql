-- This model classifies main ideas from Ethelo E3 comments into primary themes and subthemes
-- using a combination of hand-labelled data and LLM classification.

{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['comment_id'],
    on_schema_change='sync_all_columns'
) }}

-- noqa: disable=LT02
-- the `is_incremental()` causes issues with the linter. Disabling indentation QA for this CTE only.
with
main_ideas as (
    select c.*
    from {{ ref('stg_ethelo_e3_comments') }} as c
    where
        c.reply_to_id is null

        {% if is_incremental() %}
            -- Only process new records since last run
            and (
                c.posted_on > (select max(t.posted_on) from {{ this }} as t)
            )
        {% endif %}
),
-- noqa: enable=LT02

-- Load hand-labelled main ideas and adjust theme names as needed
hand_labelled as (
    select
        comment_id,
        main_idea_type as ux_main_idea_type,
        case
            when
                main_idea_primary_theme = 'Workforce and talent management'
                then 'Workforce hiring and talent management'
            else main_idea_primary_theme
        end as ux_main_idea_primary_theme,
        main_idea_subthemes as ux_main_idea_subthemes
    from {{ ref('int_ux_hand_labelled_themes') }}
),

-- Construct a single array of all subthemes for LLM input
subthemes as (
    select array_agg(object_construct('label', subtheme, 'description', subtheme_description)) as list_of_subthemes
    from {{ source('UX_AND_RESEARCH', 'E3_ALL_COMMENTS_THEME_MAPPING') }}
),

-- llm_subthemes CTE uses long lines of text that exceed line length limits.
-- Disabling line length QA for this CTE only.
-- noqa: disable=L016

-- Use LLM to classify main ideas into subthemes
llm_subthemes as (
    select --top 10
        m.posted_by_id as participant_id,
        m.comment_id,
        m.posted_on,
        m.comment_content,
        case m.target
            when 'Share your idea - Primary problem and ideas to solve the problem' then 'main_idea'
            when
                'Anything else? - Would you add any other ideas, including from your perspective as a California resident?'
                then 'other_idea'
            when 'Share what has been working - Examples' then 'whats_working'
            else 'other_question'
        end as question,
        h.ux_main_idea_type,
        h.ux_main_idea_primary_theme,
        h.ux_main_idea_subthemes,
        ai_classify(
            m.comment_content,
            subthemes.list_of_subthemes,
            {
                'task_description': 'Determine the category(-ies) that are related to the given comment from a California state employee.',
                'output_mode': 'multi',
                'examples': [
                    {
                        'input': 'Fragmented implementation, old systems, and missed opportunities for broad transformation. Establish a technology procurement review board.',
                        'labels': ['Technology modernization and standardization', 'Procurement'],
                        'explanation': 'the text mentions old and fragmented systems, so it is fits Technology modernization and standardization, and the text provides a recommendation related to procurement'
                    },
                    {
                        'input': 'Claimants inability to get in touch with Unemployment or Disability representatives over the phone. We are modernizing systems which allows us to better utilize technology which is great. I think continuing those efforts along with hiring more call center staff is essential for delivering timely service',
                        'labels': ['Public service delivery and responsiveness', 'Technology and data modernization', 'Understaffing'],
                        'explanation': 'the text centers around issues with public facing customer support so it fits public service delivery and responsiveness, technology modernization is also mentioned, and the text also provides a recommendation to hire more staff - implying that they are currently understaffed'
                    },
                    {
                        'input': 'Having empathy, without judging has always helped me. Which allows me to understand and have patience and focus on the concern instead of taking things personally.',
                        'labels': ['Work culture'],
                        'explanation': 'the text mentions empathy, patience, and judgement which are examples of traits that contribute to work culture.'
                    },
                    {
                        'input': 'As a California resident, I would like to see a decrease in taxes, more affordable housing, and a humane approach to the homeless population.',
                        'labels': ['Public policy initiatives'],
                        'explanation': 'the text mentions public policy initiatives or resident issues that could be improved by government programs.'
                    },
                    {
                        'input': 'Telework expands the talent pool by attracting capable staff regardless of location.',
                        'labels': ['Remote work and return to office', 'Hiring and recruitment'],
                        'explanation': 'the text mentions telework and attracting skilled staff, so it fits the Remote work and the Recruitment labels.'
                    }
                ]
            }):labels
            as llm_subthemes_array
    from main_ideas as m
    left join hand_labelled as h on m.comment_id = h.comment_id
    inner join subthemes as subthemes on 1 = 1
)

-- noqa: enable=L016

select * from llm_subthemes
