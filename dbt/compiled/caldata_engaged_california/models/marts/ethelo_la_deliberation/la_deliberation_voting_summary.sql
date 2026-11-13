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
    AIRTABLE_ID,
    _FIVETRAN_SYNCED
FROM TRANSFORM_ENGCA_PRD.ethelo_la_deliberation.stg_ethelo_la_deliberation_voting_summary