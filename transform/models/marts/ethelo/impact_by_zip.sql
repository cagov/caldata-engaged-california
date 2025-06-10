SELECT
    zip_code,
    zip_name,
    zip_area_sqmiles,
    zip_code_geography,

    -- primary fire name
    fire_name,

    -- Fire perimeter data
    fire_discovery_datetime,
    fire_acres,
    fire_overlap_sqmiles,
    fire_percent_of_zip,

    -- Evacuation zone data
    evac_ordr_sqmiles,
    evac_ordr_pct_zip,
    evac_wrn_sqmiles,
    evac_wrn_pct_zip,

    -- Building damage data
    destroyed_buildings,
    major_damage_buildings,
    minor_damage_buildings,
    affected_buildings,
    any_damage_buildings
FROM {{ ref('int_impact_by_zip') }}
