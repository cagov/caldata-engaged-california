--Unpivot votes table to make wide table long
with votes_wide as (
    select * from {{ ref('stg_ethelo_la_deliberation_voting') }}
    unpivot (
        vote for vote_option in
        (
            mandatory_greywater, enhanced_fire_detection, enhanced_water_infrastructure,
            increased_housing_density, underground_power_safety, homeowner_education,
            permitting_support_teams, home_ember_protection, fire_resistant_gardens,
            emergency_communication_networks, construction_training_programs,
            fire_resistant_designs, prioritize_families, financial_assistance_long_term,
            accelerated_permitting, temporary_housing, defensible_space_incentives,
            emergency_communication_hubs, find_financial_support
        )
    )
),

--enable matching vote options to comments
vote_targets as (
    select
        participant_id,
        vote_option,
        vote,
        case
            when vote_option = 'ACCELERATED_PERMITTING' then 'Accelerated ADU and duplex permitting'
            when vote_option = 'HOMEOWNER_EDUCATION' then 'Comprehensive homeowner education program'
            when vote_option = 'PERMITTING_SUPPORT_TEAMS' then 'Dedicated permitting support teams'
            when vote_option = 'DEFENSIBLE_SPACE_INCENTIVES' then 'Defensible space tax incentives'
            when vote_option = 'EMERGENCY_COMMUNICATION_HUBS' then 'Emergency communication hubs in communities'
            when vote_option = 'ENHANCED_FIRE_DETECTION' then 'Enhanced fire detection infrastructure'
            when vote_option = 'ENHANCED_WATER_INFRASTRUCTURE' then 'Enhanced water infrastructure for fire protection'
            when vote_option = 'CONSTRUCTION_TRAINING_PROGRAMS' then 'Expanded construction training programs'
            when vote_option = 'FIRE_RESISTANT_GARDENS' then 'Fire-resistant and water-friendly demonstration gardens'
            when vote_option = 'FINANCIAL_ASSISTANCE_LONG_TERM' then 'Give financial assistance to long-term residents'
            when vote_option = 'FIND_FINANCIAL_SUPPORT' then 'Help people find financial support programs'
            when vote_option = 'INCREASED_HOUSING_DENSITY' then 'Increased housing density and expedited permits'
            when vote_option = 'MANDATORY_GREYWATER' then 'Mandatory greywater systems for new buildings'
            when vote_option = 'HOME_EMBER_PROTECTION' then 'Mandatory home ember protection standards'
            when vote_option = 'FIRE_RESISTANT_DESIGNS' then 'Pre-approved fire-resistant building designs'
            when vote_option = 'PRIORITIZE_FAMILIES' then 'Prioritize families'
            when vote_option = 'EMERGENCY_COMMUNICATION_NETWORKS' then 'Resilient emergency communication networks'
            when vote_option = 'TEMPORARY_HOUSING' then 'Temporary housing'
            when vote_option = 'UNDERGROUND_POWER_SAFETY' then 'Underground power lines and equipment safety'
        end as target_name,
        _fivetran_synced

    from votes_wide
)

select * from vote_targets
