-- This model classifies main ideas from Ethelo E3 comments into primary themes and subthemes
-- using a combination of hand-labelled data and LLM classification.

{{ config(materialized='table') }}

with
main_ideas as (
    select *
    from {{ ref('stg_ethelo_e3_comments') }}
    where
        reply_to_id is null
        and target = 'Share your idea - Primary problem and ideas to solve the problem'
),

-- Load hand-labelled main ideas and adjust theme names as needed
hand_labelled as (
    select
        * exclude main_idea_primary_theme,
        case
            when
                main_idea_primary_theme = 'Workforce and talent management'
                then 'Workforce hiring and talent management'
            else main_idea_primary_theme
        end as main_idea_primary_theme
    from {{ ref('int_ux_hand_labelled_themes') }}
),

-- Mapping of primary themes to subthemes
theme_map as (
    select * from {{ source('UX_AND_RESEARCH', 'E3_MAIN_IDEA_THEME_TO_TAG_MAPPING') }}
    union distinct
    select
        'Unclassified' as main_idea_primary_theme,
        'Unclassified' as main_idea_subtheme
    from dual
),

-- Construct an array of all possible themes for LLM input
themes as (
    select array_agg(distinct trim(main_idea_tag)) as all_themes
    from theme_map
),

-- Use LLM to classify main ideas into subthemes
llm_subthemes as (
    select --top 10
        m.posted_by_id as participant_id,
        m.comment_id,
        m.posted_on,
        m.comment_content,
        h.main_idea_type,
        h.main_idea_primary_theme,
        h.main_idea_subthemes,
        ai_classify(
            m.comment_content,
            themes.all_themes,
            {
                'task_description': 'Determine the category(-ies) that are related to the given survey comment.',
                'output_mode': 'multi',
                'examples': [
                    {
                        'input': 'Fragmented implementation, old systems, and missed opportunities for
                         broad transformation. Establish a technology procurement review board.',
                        'labels': ['Procurement', 'Outdated tech systems'],
                        'explanation': 'the text mentions old systems and provides a recommendation
                         related to procurement'
                    },
                    {
                        'input': 'State Parks should use cash machines at park entrances',
                        'labels': ['Unclassified'],
                        'explanation': 'the text does not relate to any of the other categories so
                         it is tagged Unclassified.'
                    },
                    {
                        'input': 'sprawling self-storage businesses that contain hundreds of garage-like storage rooms.
                         It seems to me that these could be converted inexpensively to provide temporary, secure housing
                         for people',
                        'labels': ['Unclassified'],
                        'explanation': 'the text does not relate to any of the other categories so it is tagged
                         Unclassified.'
                    }
                ]
            }):labels
            as llm_main_idea_subthemes_array
    from main_ideas as m
    left join hand_labelled as h on m.comment_id = h.comment_id
    inner join themes as themes on 1 = 1
),

-- expand array of subthemes into multiple rows and replace empty arrays with 'Unclassified'
flattened as (
    select
        t.*,
        f.value::varchar as subtheme
    from llm_subthemes as t,
        lateral flatten(
            input => case
                when t.llm_main_idea_subthemes_array = array_construct()
                    then to_array('Unclassified')
                else t.llm_main_idea_subthemes_array
            end
        ) as f
),

-- Aggregate primary themes from mapped subthemes. Back to one row per comment.
primary_themes as (
    select
        f.participant_id,
        f.comment_id,
        f.posted_on,
        f.comment_content,
        f.main_idea_type,
        f.main_idea_primary_theme,
        f.main_idea_subthemes,
        f.llm_main_idea_subthemes_array,
        array_agg(distinct tm.main_idea_primary_theme) as llm_main_idea_primary_theme_array
    from flattened as f
    left join theme_map as tm
        on f.subtheme = tm.main_idea_tag
    group by all
)

select * from primary_themes
