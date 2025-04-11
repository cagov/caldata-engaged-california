
select
    a.PARTICIPANT_ID
    , STATUS
    , LAST_INVITE_SENT
    , VOTING_COMPLETE
    , SURVEY_COMPLETED
    , COMPLETION
    , COMMENT_COUNT
    , JOINED_ON
    , FIRE_IMPACTED_ZIP_CLEAN as ZIP
    , case when FIRE_IMPACTED_ZIP_CLEAN is not null and FIRE_NAME is null then 'Outside fire zone'
        else FIRE_NAME End as FIRE_ZONE   
    , ZIP_NAME as CITY
    , HOUSING_STATUS
    , HOUSEHOLD_INCOME_PRETAX
    , FIRE_IMPACT_EMPLOYMENT
    , CASE
        WHEN RACE_ETHNICITY = 'Black or African American' THEN 'Black or African American'
        WHEN RACE_ETHNICITY = 'Middle Eastern or North African' THEN 'Mdl Eastern or N. African'
        WHEN RACE_ETHNICITY = 'American Indian or Alaska Native' THEN 'Amer Indian or Alaska Ntv'
        ELSE RACE_ETHNICITY
    END AS RACE_ETHNICITY

    , FIRE_IMPACTED_ZIP as ORIG_ETHELO_ZIP
    , AI_AN_WRITEIN
    , ASIAN_DETAILED
    , ASIAN_WRITEIN
    , BLACK_DETAILED
    , BLACK_WRITEIN
    , HISP_LATINO_DETAILED
    , HISP_LATINO_WRITEIN
    , MENA_DETAILED
    , MENA_WRITEIN
    , NHPI_DETAILED
    , NHPI_WRITEIN
    , WHITE_DETAILED
    , WHITE_WRITEIN
from {{ ref('int_participants')}} as a
left join {{ ref('stg_survey')}} as b on a.PARTICIPANT_ID = b.PARTICIPANT_ID
left join {{ ref('mrt_impact_by_zip')}} as d on b.FIRE_IMPACTED_ZIP_CLEAN = d.ZIP_CODE
