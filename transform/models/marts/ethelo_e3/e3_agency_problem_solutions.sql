-- assumes that a problem-solution that is deemed relevant for multiple agencies should be sent to each of those agencies

with
report_agencies as (
    select distinct agency_name_and_acronym
    from {{ source('GOV_EFFICIENCIES', 'E3_RESEARCH_AGENCY_LIST') }}
    -- from RAW_ENGCA_PRD.GOV_EFFICIENCIES.E3_RESEARCH_AGENCY_LIST
    where EFFICIENCIES_REPORTS_AGENCY = TRUE
),

departments as (
    select *
    from {{ ref('stg_ethelo_e3_departments_reconciled') }}
    -- from RAW_ENGCA_PRD.GOV_EFFICIENCIES.E3_RESEARCH_DEPARTMENT_ETHELO_RECONCILED
),

problem_solutions as (
    select *
    from {{ ref('e3_consolidated_problem_solutions') }}
    -- from ANALYTICS_ENGCA_PRD.ETHELO_E3.E3_CONSOLIDATED_PROBLEM_SOLUTIONS
),

-- might be a good standalone int model
explode_problem_departments as (
    select
        problem_comment_id,
        problem_participant_id,
        problem_posted_on,
        problem_sequence,
        problem_text,
        problem_length,
        solution_count,
        avg_confidence_score,
        link_types_used,
        earliest_solution_date,
        latest_solution_date,
        consolidated_solutions,
        solution_themes,
        solution_trace_ids,
        original_solutions_detail,
        consolidation_status,
        problem_id,
        consolidated_at,
        department_user_defined,
        department_user_ai_combined,
        f.value as exploded_department
    from
        problem_solutions as ps,
        lateral flatten(split(ps.DEPARTMENT_USER_AI_COMBINED, ';')) as f
),

-- left join preserves all ideas
department_agency as (
    select
        problem_comment_id,
        problem_participant_id,
        problem_posted_on,
        problem_sequence,
        problem_text,
        problem_length,
        solution_count,
        avg_confidence_score,
        link_types_used,
        earliest_solution_date,
        latest_solution_date,
        consolidated_solutions,
        solution_themes,
        solution_trace_ids,
        original_solutions_detail,
        consolidation_status,
        problem_id,
        consolidated_at,
        department_user_defined,
        department_user_ai_combined,
        exploded_department,
        coalesce(d.WHAT_THE_DEPARTMENT_NAME_SHOULD_BE, 'Not in research list') as department,
        coalesce(d.agency, 'Not in research list') as agency
    from
        explode_problem_departments as e
        left join departments as d on d.WHAT_THE_DEPARTMENT_NAME_SHOULD_BE = e.exploded_department
),

-- get all agencies that should receive a report, group others into "Other Agency or Entity"
-- full outer join includes all agencies even if they have no associated problems
agency_ps_for_report as (
    select
        problem_comment_id,
        problem_participant_id,
        problem_posted_on,
        problem_sequence,
        problem_text,
        problem_length,
        solution_count,
        avg_confidence_score,
        link_types_used,
        earliest_solution_date,
        latest_solution_date,
        consolidated_solutions,
        solution_themes,
        solution_trace_ids,
        original_solutions_detail,
        consolidation_status,
        problem_id,
        consolidated_at,
        department_user_defined,
        department_user_ai_combined,
        listagg(department, '; ') within group (order by department) as agency_departments_involved,
        coalesce(a.agency_name_and_acronym, 'Other Agency or Entity') as report_agency
    from department_agency as d
    full outer join report_agencies a on d.agency = a.agency_name_and_acronym
    group by
        all
)

select
    *,
    row_number() over (partition by report_agency order by problem_id) as agency_problem_num,
    count(problem_id) over (partition by report_agency) as count_problems_for_agency
from agency_ps_for_report
