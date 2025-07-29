--Pull all records from the Voting Summary table in Airtable
SELECT
    TOPIC,
    OPTION,
    -- Likert scale value vote totals
    STRONGLY_OPPOSED,
    OPPOSED,
    SOMEWHAT_OPPOSED,
    NEUTRAL,
    SOMEWHAT_SUPPORTIVE,
    SUPPORTIVE,
    STRONGLY_SUPPORTIVE,
    -- Vote totals and abstractions
    ABSTAIN_VOTES,
    TOTAL_VOTES,
    POSITIVE_VOTES,
    NEGATIVE_VOTES,
    -- Calculated metrics
    SUPPORT,
    CONSENSUS,
    CONFLICT,
    APPROVAL,
    AVERAGE_WEIGHTING,
    -- Other fields
    IN_BEST_SCENARIO,
    ID AS AIRTABLE_ID,
    _FIVETRAN_SYNCED
FROM {{ source('ETHELO_LA_DELIBERATION', 'VOTING_SUMMARY') }}
