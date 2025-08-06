/*This model preps the disaggregated voting data from Ethelo by removing or renaming columns and
removing all users likely to be ODI staff members, moderators, or Ethelo staff.
*/

--Cleaning and filtering the voting data from Ethelo
WITH voting_data AS (
    SELECT
        participant AS participant_id,
        -- voting options:
        mandatory_greywater_systems_for_new_buildings AS mandatory_greywater,
        enhanced_fire_detection_infrastructure AS enhanced_fire_detection,
        enhanced_water_infrastructure_for_fire_protection AS enhanced_water_infrastructure,
        increased_housing_density_and_expedited_permits AS increased_housing_density,
        underground_power_lines_and_equipment_safety AS underground_power_safety,
        comprehensive_homeowner_education_program AS homeowner_education,
        dedicated_permitting_support_teams AS permitting_support_teams,
        mandatory_home_ember_protection_standards AS home_ember_protection,
        fire_resistant_and_water_friendly_demonstration_gardens AS fire_resistant_gardens,
        resilient_emergency_communication_networks AS emergency_communication_networks,
        expanded_construction_training_programs AS construction_training_programs,
        pre_approved_fire_resistant_building_designs AS fire_resistant_designs,
        prioritize_families,
        give_financial_assistance_to_long_term_residents AS financial_assistance_long_term,
        accelerated_adu_and_duplex_permitting AS accelerated_permitting,
        temporary_housing,
        defensible_space_tax_incentives AS defensible_space_incentives,
        emergency_communication_hubs_in_communities AS emergency_communication_hubs,
        help_people_find_financial_support_programs AS find_financial_support,

        --fivetran metadata
        _directory,
        _file,
        _fivetran_synced
    FROM {{ source('FIVETRAN_EMAIL_CONNECTOR', 'ETHELO_EMAILED_REPORTS') }}
),

--bring in the filtered list of participants (no beta testers)
participants_filtered AS (
    SELECT participant_id
    FROM {{ ref('stg_ethelo_la_deliberation_participants') }}
),

--filtering the voting data to only include participants in the filtered list
filtered_votes AS (
    SELECT a.*
    FROM voting_data AS a
    INNER JOIN participants_filtered AS b
        ON a.participant_id = b.participant_id

)

SELECT * FROM filtered_votes
