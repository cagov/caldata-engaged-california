with
llm_subthemes as (
    select * from ANALYTICS_ENGCA_PRD.ethelo_e3.e3_topic_themes_ux_ai
),

-- Mapping of primary themes to subthemes
theme_map as (
    select * from RAW_ENGCA_PRD.ENGAGEDCA_UX_AND_RESEARCH.E3_ALL_COMMENTS_THEME_MAPPING
),

-- polished CTE uses long lines of text that exceed line length limits.
-- Disabling line length QA for this CTE only.
-- noqa: disable=L016

polished as (
    select
        *,
        case
            when comment_id = '5127'
                then
                    parse_json(
                        '[ "Remote work and return to office", "Environmental sustainability", "Office management", "Physical infrastructure", "Employee pay and benefits", "Employee retention", "Hiring and recruitment", "Accessibility", "Inclusion and diversity", "Public service delivery and responsiveness" ]'
                    )
            when comment_id = '3800'
                then
                    parse_json(
                        '[ "Remote work and return to office", "Environmental sustainability", "Physical infrastructure", "Work culture", "Employee pay and benefits", "Employee retention", "Hiring and recruitment", "Trust and openness" ]'
                    )
            when comment_id = '4919'
                then
                    parse_json(
                        '[ "Management culture and leadership approach", "Work culture", "Hiring and recruitment", "Qualified staff", "Employee performance reviews" ]'
                    )
            when comment_id = '3931'
                then parse_json('[ "Physical infrastructure", "Public policy initiatives", "Public participation", "Environmental sustainability" ]')
            when comment_id = '5164'
                then
                    parse_json(
                        '[ "Physical infrastructure", "Remote work and return to office", "Office management", "Employee retention", "Hiring and recruitment", "Budgeting and funding", "Inclusion and diversity" ]'
                    )
            when comment_id = '4083'
                then
                    parse_json('[ "Remote work and return to office", "Office management", "Physical infrastructure", "Environmental sustainability" ]')
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
                        '["Inclusion and diversity", "Remote work and return to office", "Public service delivery and responsiveness", "Physical infrastructure", "Office management", "Budgeting and funding", "Environmental sustainability" ]'
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
            when comment_id = '5549'
                then parse_json('[ "Management culture and leadership approach", "Org structure and hierarchy", "Employee pay and benefits" ]')
            when comment_id = '6041'
                then
                    parse_json(
                        '[ "Accountability and transparency",  "Inclusion and diversity", "Policy development process", "Policymaking", "Public policy initiatives" ]'
                    )
            when comment_id = '4080'
                then
                    parse_json(
                        '[ "Inclusion and diversity", "Accessibility", "Accountability and transparency",   "Remote work and return to office", "Process delays", "Work culture", "Trust and openness", "Compliance", "Bureaucracy" ]'
                    )
            when comment_id = '3815'
                then
                    parse_json(
                        '[ "Management culture and leadership approach", "Accountability and transparency", "Trust and openness",   "Process delays", "Process design and methodologies", "Process documentation", "Public service delivery and responsiveness", "Internal feedback"]'
                    )
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