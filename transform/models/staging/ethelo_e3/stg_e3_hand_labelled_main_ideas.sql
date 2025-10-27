--downloaded from Coda -- this is a list of 400+ 'main ideas' that were hand-labelled
--for themes and types by the UX and Research teams. The comments they worked off of
--were already filtered by participant and date, so no need for the usual staging filters on this table.


WITH hand_labels AS (
    SELECT *
    FROM {{ source('UX_AND_RESEARCH', 'E3_HAND_LABELLED_MAIN_IDEAS') }}
)

SELECT * FROM hand_labels
