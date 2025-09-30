WITH department_dropdown AS (
    SELECT *
    FROM {{ source('GOV_EFFICIENCIES', 'E3_ENGAGEDCA_DEPARTMENT_DROPDOWN') }}
)

SELECT * FROM department_dropdown
