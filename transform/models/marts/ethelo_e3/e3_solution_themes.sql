-- depends_on: {{ ref('int_extracted_solutions') }}

{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['solution_id'],
    on_schema_change='sync_all_columns'
) }}

-- noqa: disable=LT02
-- the `is_incremental()` causes issues with the linter. Disabling indentation QA for this CTE only.
with solutions as (
    select
        s.solution_id,
        s.comment_id as solution_comment_id,
        s.reply_to_id,
        s.source_comment,
        s.solution_sequence,
        s.solution_text
    from {{ ref('int_extracted_solutions') }} as s

        {% if is_incremental() %}
            -- Only process solutions that have not yet been processed
            where (s.solution_id) not in
                (
                    select t.solution_id
                    from {{ this }} as t
                )
        {% endif %}

),
-- noqa: enable=LT02

theme_map as (
    select
        main_theme,
        subtheme,
        subtheme_description
    from {{ source('UX_AND_RESEARCH', 'E3_ALL_COMMENTS_THEME_MAPPING') }}
),

subthemes as (
    select array_agg(object_construct('label', subtheme, 'description', subtheme_description)) as list_of_subthemes
    from theme_map
),

-- classified_solutions CTE uses long lines of text that exceed line length limits.
-- Disabling line length QA for this CTE only.
-- noqa: disable=L016
classified_solutions as (
    select
        s.*,
        ai_classify(
            s.solution_text,
            subthemes.list_of_subthemes,
            {
                'task_description': 'Determine the category that is most related to the'
                || ' given solution idea from a California state employee.',
                'output_mode': 'multi',
                'examples': [
                    {
                        'input': 'Establish a technology procurement review board.',
                        'labels': ['Procurement'],
                        'explanation': 'the text provides a recommendation related to procurement'
                    },
                    {
                        'input': 'Provide enhanced training for managers and supervisors covering leadership skills, effective communication with subordinates, and clear understanding of job duties and descriptions',
                        'labels': ['Manager training'],
                        'explanation': 'Even though the text mentions leadership skills and communication, the core idea is enhanced manager training'
                    },
                    {
                        'input': 'Empower staff to make process improvements. Give employees ownership and accountability to create innovative ideas, especially in state contracting from start to finish',
                        'labels': ['Management culture and leadership approach', 'Work culture', 'Trust and openness'],
                        'explanation': 'the text centers on empowering employees and giving trust, so it fits Management culture and leadership approach, Work culture, and Trust and openness'
                    },
                    {
                        'input': 'Stop outsourcing and using private contractors. Build all projects from the ground up using state employees and their input on how systems should work',
                        'labels': ['Contracts and vendors', 'Internal feedback'],
                        'explanation': 'The idea is about reducing reliance on contractors and getting input from employees (internal staff)'
                    },
                    {
                        'input': 'Push for all workers who can work from home to do so, not just state employees. Lead California toward less car traffic and remote work as the future.',
                        'labels': ['Remote work and return to office'],
                        'explanation': 'The idea focuses on remote work. Less car traffic does not necessarily relate to public transportation, so that label is not included.'
                    },
                    {
                        'input': 'Make job requirements less strict for environmental and air quality positions. Create programs for current staff to gain skills or credits needed to move into jobs with strict education requirements.',
                        'labels': ['Career growth', 'Qualified staff', 'Employee training', 'Job classification'],
                        'explanation': 'Job requirements are related to job classifications. Creating programs for current staff to gain skills relates to employee training and qualified staff. And moving into new jobs relates to career growth.'
                    },
                    {
                        'input': 'Make smarter spending decisions. Talk to front-line workers about their needs before buying equipment or supplies.',
                        'labels': ['Participatory budgeting', 'Procurement', 'Internal feedback'],
                        'explanation': 'The solution idea is about getting input from employees so "Internal feedback" applies. The idea also relates specifically to getting input on spending decisions (so "Participatory budgeting") and procurement decisions (so "Procurement").'
                    },
                    {
                        'input': 'Expand telework to full remote work to save more than $225 million and fund infrastructure improvements',
                        'labels': ['Budgeting and funding', 'Remote work and return to office'],
                        'explanation': 'The solution idea focuses on remote work and specifically mentions this will lead to budget savings'
                    },
                    {
                        'input': 'Bring website technical management in-house to improve efficiency, save costs, and build state technical skills',
                        'labels': ['Contracts and vendors', 'Employee training'],
                        'explanation': 'Bringing work in-house implies moving away from contractors, so the label "Contracts and vendors" is applied. Additionally, building state technical skills relates to "Employee training".'
                    },
                    {
                        'input': 'Model California programs after European countries. Focus on work hours, medical care, and public transportation systems.',
                        'labels': ['Public policy initiatives', 'Public transportation'],
                        'explanation': 'In this case, the solution idea is about public facing initiatives, including public transportation, and not employee pay and benefits, so the label "employee pay and benefits" is not applied.'
                    },
                    {
                        'input': 'Switch from network drives to SharePoint for file sharing and collaboration. Use SharePoint links instead of email attachments for document review to improve version control and enable real-time teamwork.',
                        'labels': ['State cloud storage', 'Digitize processes', 'Technology and data modernization'],
                        'explanation': 'The idea specifically mentions moving to SharePoint, a cloud storage solution, and mentions adopting modern technology. The "digitize processes" label is applied because the idea specifically mentions using digital tools to improve processes. The "Digital services" tag is not applied because this idea does not involve public-facing digital services.'
                    },
                    {
                        'input': 'Improve communication between headquarters and facilities. Allow staff to hold meetings, record discussions, and share training materials without lengthy approval processes.',
                        'labels': ['Internal communication', 'Bureaucracy'],
                        'explanation': 'The idea focuses on improving internal communication. Lengthy approval processes implies bureaucratic process inefficiencies.'
                    },
                    {
                        'input': 'Use prison tablets for education. Have students use the tablets they already have for learning instead of just communication and entertainment.',
                        'labels': ['Digital services'],
                        'explanation': 'This idea is focused on improving digital services for the public. It does not relate to technology for internal state employees.'
                    },
                    {
                        'input': 'Reduce salary and benefits costs across state organizations to create budget savings.',
                        'labels': ['Budgeting and funding', 'Employee pay and benefits'],
                        'explanation': 'This idea explicitly discusses employee pay and benefits and state budgets.'
                    },
                    {
                        'input': 'Use texting to keep staff informed and improve team communication.',
                        'labels': ['Internal communication']
                    },
                    {
                        'input': 'Standardize technology platforms and data-sharing protocols across all state departments.',
                        'labels': ['Technology and data modernization', 'Cross-agency collaboration', 'Shared data']
                    },
                    {
                        'input': 'Create shared dashboards and data dictionaries to improve collaboration between teams and reduce rework.',
                        'labels': ['Shared data', 'Shared resources', 'Software and tools', 'Cross-agency collaboration']
                    },
                    {
                        'input': 'Create shared office buildings for multiple state departments.',
                        'labels': ['Cross-agency collaboration', 'Office management', 'Physical infrastructure']
                    },
                    {
                        'input': 'Transfer fingerprint clearance records to CalHR. State workers switching departments would not need new fingerprint checks. Hiring agencies would check clearances with CalHR before hiring and notify CalHR when employees leave.',
                        'labels': ['Shared data', 'Hiring and recruitment']
                    },
                    {
                        'input': 'Combine services across small state departments. Share resources like translation, website help, audio/video services, and cabling to cut costs and reduce staff burnout.',
                        'labels': ['Cross-agency collaboration', 'Shared resources', 'Translations']
                    },
                    {
                        'input': 'Fix payroll system to pay employees on time and correctly. Make paystubs clearer so staff can easily see all their pay.',
                        'labels': ['Technology and data modernization', 'Employee pay and benefits'],
                        'explanation': 'This idea has to do with employee pay and with fixing an existing, employee-focused technology (payroll system), so Technology and data modernization is applied.'
                    },
                    {
                        'input': 'Create a universal employee intranet site.',
                        'labels': ['Software and tools', 'Shared resources']
                    },
                    {
                        'input': 'Require licensed clinical staff at each site.',
                        'labels': ['Qualified staff']
                    },
                    {
                        'input': 'Reduce fear of technology. Trust staff to test new ideas and implement successful ones.',
                        'labels': ['Risk aversion', 'Management culture and leadership approach', 'Technology and data modernization']
                    },
                    {
                        'input': 'Embrace innovation and stop using "always been done this way" as an excuse.',
                        'labels': ['Growth mindset']
                    },
                    {
                        'input': 'Make state worker unions stronger so they can better fight for employee rights and fair pay.',
                        'labels': ['Employee pay and benefits']
                    },
                    {
                        'input': 'Help recruit and keep talented workers by reducing their student loan debt.',
                        'labels': ['Employee pay and benefits', 'Employee retention']
                    },
                    {
                        'input': 'Cross-train employees so staff can handle multiple roles and work more efficiently.',
                        'labels': ['Employee training']
                    },
                    {
                        'input': 'Provide training on how to put policies into action successfully.',
                        'labels': ['Employee training', 'Align policy and implementation']
                    },
                    {
                        'input': 'Include all stakeholders when making program changes. Ask staff for their ideas and opinions since they have valuable expertise.',
                        'labels': ['Internal feedback']
                    },
                    {
                        'input': 'Create a single online platform for all California state employees to submit timesheets across all departments.',
                        'labels': ['Software and tools', 'Shared resources']
                    },
                    {
                        'input': 'Write clear process guides for all team tasks.',
                        'labels': ['Process documentation']
                    }
                ]
            }):labels
            as solution_subthemes_array
    from solutions as s
    inner join subthemes as subthemes on 1 = 1
)
-- noqa: enable=L016

select
    solution_id,
    solution_comment_id,
    reply_to_id,
    source_comment,
    solution_sequence,
    solution_text,
    solution_subthemes_array
from classified_solutions
