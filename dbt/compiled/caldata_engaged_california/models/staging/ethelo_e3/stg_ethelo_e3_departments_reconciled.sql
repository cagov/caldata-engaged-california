WITH department_reconciled AS (
    SELECT *
    FROM RAW_ENGCA_PRD.GOV_EFFICIENCIES.E3_RESEARCH_DEPARTMENT_ETHELO_RECONCILED
)

SELECT
    status AS reconciliation_status,
    what_the_department_name_should_be,
    label_in_ethelo_survey_question,
    state_department,
    agency,
    government_branch_from_agency,
    notes
FROM department_reconciled
WHERE
    what_the_department_name_should_be IS NOT NULL
    AND status != 'Recommend removing'