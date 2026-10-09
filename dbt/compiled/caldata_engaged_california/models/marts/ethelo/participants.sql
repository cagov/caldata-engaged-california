select
    a.participant_id,
    a.status,
    a.last_invite_sent,
    a.voting_complete,
    a.survey_completed,
    a.completion,
    a.comment_count,
    a.joined_on,
    b.fire_impacted_zip_clean as zip,
    case
        when b.fire_impacted_zip_clean is not null and d.fire_name is null then 'Outside fire zone'
        else d.fire_name
    end as fire_zone,
    d.zip_name as city,
    b.housing_status,
    b.household_income_pretax,
    b.fire_impact_employment,
    case
        when b.race_ethnicity = 'Black or African American' then 'Black or African American'
        when b.race_ethnicity = 'Middle Eastern or North African' then 'Mdl Eastern or N. African'
        when b.race_ethnicity = 'American Indian or Alaska Native' then 'Amer Indian or Alaska Ntv'
        else b.race_ethnicity
    end as race_ethnicity,

    b.fire_impacted_zip as orig_ethelo_zip,
    b.ai_an_writein,
    b.asian_detailed,
    b.asian_writein,
    b.black_detailed,
    b.black_writein,
    b.hisp_latino_detailed,
    b.hisp_latino_writein,
    b.mena_detailed,
    b.mena_writein,
    b.nhpi_detailed,
    b.nhpi_writein,
    b.white_detailed,
    b.white_writein,
    a._fivetran_synced
from TRANSFORM_ENGCA_PRD.ethelo.stg_participants as a
left join TRANSFORM_ENGCA_PRD.ethelo.stg_survey as b on a.participant_id = b.participant_id
left join TRANSFORM_ENGCA_PRD.ethelo.int_impact_by_zip as d on b.fire_impacted_zip_clean = d.zip_code