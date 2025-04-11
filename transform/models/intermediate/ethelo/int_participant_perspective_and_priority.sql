SELECT
    PARTICIPANT,
    TARGET,
    CONTENT
FROM (
SELECT
    PARTICIPANT,
    WHAT_IS_YOUR_PERSPECTIVE_ON_LA_S_RECOVERY_ as "Main Recovery Perspective",
    WHAT_MUST_BE_ADDRESSED_FIRST_TO_ENSURE_A_SUCCESSFUL_RECOVERY_ as "Main Recovery Priority"
FROM {{ source('ETHELO', 'SURVEY_BY_EMAIL') }} a
    LEFT JOIN  {{ ref('TEST_PARTICIPANTS') }} AS b
        ON a.PARTICIPANT = b.participant_id
    WHERE b.participant_id IS NULL // Keep only rows that *don't* match a test participant
    

) UNPIVOT(
CONTENT FOR TARGET IN ("Main Recovery Perspective", "Main Recovery Priority")
) 
where  length(trim(content)) > 0

