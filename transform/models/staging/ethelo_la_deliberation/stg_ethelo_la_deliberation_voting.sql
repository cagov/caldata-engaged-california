/*This model preps the disaggregated voting data from Ethelo by removing or renaming columns and
removing all users likely to be ODI staff members, moderators, or Ethelo staff.
*/

--Cleaning and filtering the voting data from Ethelo
WITH voting_data AS (
    SELECT 
        PARTICIPANT as participant_id,
        -- voting options:
        MANDATORY_GREYWATER_SYSTEMS_FOR_NEW_BUILDINGS as mandatory_greywater, 
        ENHANCED_FIRE_DETECTION_INFRASTRUCTURE as enhanced_fire_detection, 
        ENHANCED_WATER_INFRASTRUCTURE_FOR_FIRE_PROTECTION as enhanced_water_infrastructure, 
        INCREASED_HOUSING_DENSITY_AND_EXPEDITED_PERMITS as increased_housing_density, 
        UNDERGROUND_POWER_LINES_AND_EQUIPMENT_SAFETY as underground_power_safety, 
        COMPREHENSIVE_HOMEOWNER_EDUCATION_PROGRAM as homeowner_education, 
        DEDICATED_PERMITTING_SUPPORT_TEAMS as permitting_support_teams, 
        MANDATORY_HOME_EMBER_PROTECTION_STANDARDS as home_ember_protection, 
        FIRE_RESISTANT_AND_WATER_FRIENDLY_DEMONSTRATION_GARDENS as fire_resistant_gardens, 
        RESILIENT_EMERGENCY_COMMUNICATION_NETWORKS as emergency_communication_networks, 
        EXPANDED_CONSTRUCTION_TRAINING_PROGRAMS as construction_training_programs, 
        PRE_APPROVED_FIRE_RESISTANT_BUILDING_DESIGNS as fire_resistant_designs, 
        PRIORITIZE_FAMILIES as prioritize_families, 
        GIVE_FINANCIAL_ASSISTANCE_TO_LONG_TERM_RESIDENTS as financial_assistance_long_term, 
        ACCELERATED_ADU_AND_DUPLEX_PERMITTING as accelerated_permitting, 
        TEMPORARY_HOUSING as temporary_housing, 
        DEFENSIBLE_SPACE_TAX_INCENTIVES as defensible_space_incentives, 
        EMERGENCY_COMMUNICATION_HUBS_IN_COMMUNITIES as emergency_communication_hubs, 
        HELP_PEOPLE_FIND_FINANCIAL_SUPPORT_PROGRAMS as find_financial_support,

        --sentiment questions
        OPENING_QUESTIONS_HOW_WOULD_YOU_DESCRIBE_YOUR_OVERALL_OUTLOOK_ON_LOS_ANGELES_S_RECOVERY_FROM_THE_WILDFIRES_
            as sentiment_opening_overall_outlook, 
        FINAL_THOUGHTS_HOW_DO_YOU_FEEL_ABOUT_THE_COMMUNITY_S_TOP_RECOVERY_OPTIONS_AS_THEY_STAND_NOW_ 
            as sentiment_final_top_recovery_options, 
        FINAL_THOUGHTS_SHARE_MORE_ABOUT_YOUR_GENERAL_OUTLOOK_ON_FIRES_RECOVERY
            as sentiment_final_general_outlook, 
        FINAL_THOUGHTS_DID_TAKING_THE_SURVEY_INCREASE_YOUR_CONFIDENCE_IN_LOS_ANGELES_FIRES_RECOVERY_EFFORTS_IN_GENERAL_
            as sentiment_final_confidence_in_recovery_efforts, 
        
        --fivetran metadata
        _DIRECTORY, 
        _MODIFIED, 
        _FILE, 
        _LINE, 
        _SHEET_NAME, 
        _FIVETRAN_SYNCED
    FROM {{ source('FIVETRAN_EMAIL_CONNECTOR', 'ETHELO_EMAILED_REPORTS') }}
),

--bring in the filtered list of participants (no beta testers)
participants_filtered AS (
    SELECT
        participant_id
    FROM {{ ref('stg_ethelo_la_deliberation_participants') }}
),

--filtering the voting data to only include participants in the filtered list
filtered_votes AS (
    SELECT
        a.*
    FROM voting_data as a
    INNER JOIN participants_filtered as b 
    on a.participant_id = b.participant_id

)

SELECT * FROM filtered_votes
