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

-- Mapping of primary themes to subthemes
theme_map as (
    select
        main_theme,
        subtheme,
        subtheme_description
    from {{ source('UX_AND_RESEARCH', 'E3_ALL_COMMENTS_THEME_MAPPING') }}
    --the following section should be removed after adding to mapping table
    --also consider consolidating limited-term positions which had only 3 comments tagged in the most dev recent run
    union distinct
    select
        'Workplace operations' as main_theme,
        'Environmental sustainability' as subtheme,
        -- noqa: disable=L016
        'Comments about workplace practices relating to environmental stewardship, carbon emissions, and uses of natural resources'
            as subtheme_description
-- noqa: enable=L016
),

-- Construct a single array of all subthemes for LLM input
subthemes as (
    select array_agg(object_construct('label', subtheme, 'description', subtheme_description)) as list_of_subthemes
    from theme_map
),

-- llm_subthemes and polished CTEs use long lines of text that exceed line length limits.
-- Disabling line length QA for these CTEs only.
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
                        'labels': [
                            'Public service delivery and responsiveness',
                            'Technology and data modernization',
                            'Understaffing'
                        ],
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
),

polished as (
    select
        *,
        case
            when comment_id = '5127'
                then
                    parse_json(
                        '[ "Remote work and return to office", "Office management", "Physical infrastructure", "Employee pay and benefits", "Employee retention", "Hiring and recruitment", "Accessibility", "Inclusion and diversity", "Public service delivery and responsiveness" ]'
                    )
            when comment_id = '3800'
                then
                    parse_json(
                        '[ "Remote work and return to office", "Physical infrastructure", "Work culture", "Employee pay and benefits", "Employee retention", "Hiring and recruitment", "Trust and openness" ]'
                    )
            when comment_id = '4919'
                then
                    parse_json(
                        '[ "Management culture and leadership approach", "Work culture", "Hiring and recruitment", "Qualified staff", "Employee performance reviews" ]'
                    )
            when comment_id = '3931'
                then parse_json('[ "Physical infrastructure", "Public policy initiatives", "Public participation" ]')
            when comment_id = '5164'
                then
                    parse_json(
                        '[ "Physical infrastructure", "Remote work and return to office", "Office management", "Employee retention", "Hiring and recruitment", "Budgeting and funding", "Inclusion and diversity" ]'
                    )
            when comment_id = '4083'
                then
                    parse_json('[ "Remote work and return to office", "Office management", "Physical infrastructure" ]')
            when comment_id = '4037'
                then
                    parse_json(
                        '[ "Digitize processes", "Internal communication", "Knowledge management", "Leadership review and oversight", "Management culture and leadership approach", "Process design and methodologies", "Process documentation", "Shared resources", "Software and tools", "Technology and data modernization" ]'
                    )
            when comment_id = '5653'
                then parse_json('[ "Digitize processes", "Technology and data modernization" ]')
            when comment_id = '4798'
                then
                    parse_json(
                        '["Inclusion and diversity", "Remote work and return to office", "Public service delivery and responsiveness", "Physical infrastructure", "Office management", "Budgeting and funding" ]'
                    )
            when comment_id = '5805'
                then parse_json('["Work culture"]')
            when comment_id = '3930'
                then parse_json('["Public policy initiatives"]')
            when comment_id = '6000'
                then
                    parse_json(
                        '["Org structure and hierarchy", "Management culture and leadership approach", "Onboarding new employees", "Career growth", "Employee training", "Remote work and return to office"]'
                    )
            when comment_id = '4203'
                then
                    parse_json(
                        '["Remote work and return to office", "Physical infrastructure", "Office management", "Employee pay and benefits", "Inclusion and diversity", "Budgeting and funding", "Public transportation"]'
                    )
            when comment_id = '4277'
                then parse_json('["Hiring and recruitment", "Qualified staff", "Work culture"]')
            when comment_id = '4650'
                then
                    parse_json(
                        '["Internal communication", "Cross-agency collaboration", "Org structure and hierarchy", "Policymaking", "Align policy and implementation", "Policy development process"]'
                    )
            when comment_id = '4467'
                then
                    parse_json(
                        '["Knowledge management", "Internal feedback", "Inclusion and diversity", "Networking", "Career growth", "Mentorship programs", "Employee retention", "Employee training"]'
                    )
            when comment_id = '5666'
                then
                    parse_json(
                        '["Budgeting and funding", "Permits, licensing, and fees", "Cross-agency collaboration", "Process delays"]'
                    )
            when comment_id = '5917'
                then parse_json('["Public policy initiatives"]')
            when llm_subthemes_array = array_construct()
                then to_array('Other ideas')
            else llm_subthemes_array
        end as polished_subthemes_array,
        array_size(polished_subthemes_array) as num_polished_subthemes
    from llm_subthemes
),
-- noqa: enable=L016

-- expand array of subthemes into multiple rows
flattened as (
    select
        t.*,
        f.value::varchar as subtheme
    from polished as t,
        lateral flatten(input => t.polished_subthemes_array) as f
),

-- Aggregate primary themes from mapped subthemes. Back to one row per comment.
primary_themes as (
    select
        f.participant_id,
        f.comment_id,
        f.posted_on,
        f.question,
        f.comment_content,
        array_agg(distinct coalesce(tm.main_theme, 'Other')) as polished_main_theme_array,
        f.polished_subthemes_array,
        f.num_polished_subthemes,
        f.llm_subthemes_array,
        f.ux_main_idea_type,
        f.ux_main_idea_primary_theme,
        f.ux_main_idea_subthemes
    from flattened as f
    left join theme_map as tm
        on f.subtheme = tm.subtheme
    group by all
)

select * from primary_themes
