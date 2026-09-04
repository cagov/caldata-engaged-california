SELECT
    z.zip_code,
    z.po_name AS zip_name,
    z.sqmi AS zip_area_sqmiles,
    z.zip_code_geography,
    -- Use COALESCE to get the primary fire name or the fire name from the perimeter data
    INITCAP(COALESCE(p.primary_fire, f.fire_name)) AS fire_name,
    -- Fire perimeter data
    f.fire_discovery_datetime,
    f.fire_acres,
    f.overlap_area_sqmiles AS fire_overlap_sqmiles,
    f.percent_of_zip_affected AS fire_percent_of_zip,

    -- Evacuation zone data
    e.evac_ordr_sqmiles,
    e.evac_ordr_pct_zip,
    e.evac_wrn_sqmiles,
    e.evac_wrn_pct_zip,

    -- Building damage data
    b.destroyed_buildings,
    b.major_damage_buildings,
    b.minor_damage_buildings,
    b.affected_buildings,
    b.any_damage_buildings
FROM TRANSFORM_ENGCA_PRD.ethelo.stg_ca_zips AS z
LEFT JOIN TRANSFORM_ENGCA_PRD.ethelo.int_fire_perimeter_overlap_by_zip AS f ON z.zip_code = f.zip_code
LEFT JOIN TRANSFORM_ENGCA_PRD.ethelo.int_evac_zone_overlap_by_zip AS e ON z.zip_code = e.zip_code
LEFT JOIN TRANSFORM_ENGCA_PRD.ethelo.int_building_damage_by_zip AS b ON z.zip_code = b.zip_code
LEFT JOIN TRANSFORM_ENGCA_PRD.ethelo.int_primary_fire_by_zip AS p ON z.zip_code = p.zip_code
ORDER BY
    COALESCE(f.percent_of_zip_affected, 0) DESC,
    COALESCE(e.evac_ordr_pct_zip, 0) + COALESCE(e.evac_wrn_pct_zip, 0) DESC,
    COALESCE(b.any_damage_buildings, 0) DESC