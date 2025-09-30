WITH department_reconciled AS (
    SELECT *
    FROM {{ source('GOV_EFFICIENCIES', 'E3_RESEARCH_DEPARTMENT_ETHELO_RECONCILED') }}
)

SELECT
    status as reconciliation_status,
    what_the_department_name_should_be,
    label_in_ethelo_survey_question,
    state_department,
    agency,
    government_branch_from_agency,
    notes
FROM department_reconciled
WHERE what_the_department_name_should_be IS NOT NULL
    AND status != 'Recommend removing'
