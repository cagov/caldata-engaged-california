-- This model populates the department field for each comment based on department survey response and comment contents
-- It uses an LLM to fill in gaps where the survey response is missing or does not match a known department

{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['comment_id'],
    on_schema_change='sync_all_columns'
) }}

with
comments as (
    select *
    from {{ ref('stg_ethelo_e3_comments') }}
    where reply_to_id is null  --only top level comments (ideas)
),

departments as (
    select distinct
        participant_id,
        answer as department
    from {{ ref('stg_ethelo_e3_survey') }}
    where question = 'Share your idea - Which department or agency does your idea apply to?'
),

dept_reconciled as (
    select
        reconciliation_status,
        what_the_department_name_should_be as known_department,
        label_in_ethelo_survey_question
    from {{ ref('stg_ethelo_e3_departments_reconciled') }}
    --filter out non-specific entries so that llm will still attempt to fill in those cases
    where what_the_department_name_should_be not in (
        'All departments',
        'Affects multiple departments',
        'I''d rather not say'
    )
),

department_list_for_prompt as (
    select listagg(distinct known_department, ';') within group (order by known_department) as department_list
    from dept_reconciled
),

--this join will duplicate some comments
--this join ignores some dept responses that do not have an associated comment
--these are cases where the participant id has a dept_response, but there is no associated idea
--TO DO: investigate why there are dept_responses that have no comment

comments_with_depts as (
    select
        c.posted_by_id,
        c.comment_id,
        d.department,
        c.comment_content,
        dr.known_department
    from comments as c
    left join departments as d on c.posted_by_id = d.participant_id
    left join dept_reconciled as dr on d.department = dr.label_in_ethelo_survey_question
),

fill_in_dept as (
--fill in department gaps for those comments without a department provided
--or where the department provided doesn't match a dropdown value
    select
        posted_by_id,
        comment_id,
        department,
        comment_content,
        coalesce(
            known_department,
            ai_complete(
                --model => 'mixtral-8x7b',
                --model => 'claude-4-sonnet',
                model => '{{ var("llm_model") }}',
                prompt => concat(
                    'Use the comment and user specified department below to return the relevant
                    California agency (or agencies). \n\n',
                    'IMPORTANT: Your output should be ONLY a single california agency or a semicolon-separated string,
                    ex:California Agency (CA);Another Cal Department (ACD);...\n\n',

                    'Comment: ', coalesce(comment_content, '[No Content]'), '\n\n',
                    'User Specified Department: ', coalesce(department, '[No Content]'), '\n\n',

                    'Here is a semicolon-separated list of valid departments to choose from,
                    with their acronyms in parentheses: ',
                    (select d.department_list from department_list_for_prompt as d), '\n\n',

                    'INSTRUCTIONS:\n',
                    '• Look for agency full names and acronyms in the comment and in the user specified department\n',
                    '• Return all agencies that are specifically mentioned in the comment or the user specified
                    department (can be multiple)\n',
                    '• Do not list multiple agencies unless they are specifically mentioned by name or acronym
                    in the comment or user specified department.\n',
                    '• If no specific agency mentions are found, then, if possible, provide the single most relevant
                    agency based on the comment\n',
                    '• If the comment or user specified department applies to all or most agencies,
                    return "Affects multiple departments"\n',
                    '• If it is not possible to determine a relevant agency, then return UNSPECIFIED',

                    'EXAMPLES:\n',
                    'CDT authentication → California Department of Technology (CDT)\n',
                    'CalHR and Spb processes → Department of Human Resources (CalHR);State Personnel Board (SPB)\n',
                    'dept of food and agriculture → Department of Food and Agriculture (CDFA)\n',
                    'Cannabis program  → Department of Cannabis Control (DCC)\n',
                    'Need more help from leadership → UNSPECIFIED\n',
                    'Probably all of them → Affects multiple departments\n\n',

                    --'Return ONLY JSON: {"agencies": ["AGENCY1", "AGENCY2"]}'
                    'IMPORTANT: Your output must be ONLY a single california agency or a semicolon-separated string,
                    ex:California Agency (CA);Another Cal Department (ACD);...'
                ),
                model_parameters => object_construct(
                    'temperature', 0.05,
                    'max_tokens', 100,
                    'top_p', 0.05
                )
            )
        ) as departments
    from comments_with_depts
),

agg_to_single_dept_list_per_comment as (
    select
        comment_id,
        listagg(department, ';') within group (order by department) as department_user_defined,
        array_to_string(
            array_distinct(
                array_flatten(
                    array_agg(
                        transform(
                            split(departments, ';'),
                            x -> trim(x::string)
                        )
                    )
                )
            ), '; '
        ) as department_user_ai_combined
    from fill_in_dept
    group by comment_id
)

select * from agg_to_single_dept_list_per_comment
