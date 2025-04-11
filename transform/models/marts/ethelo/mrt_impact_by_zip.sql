    SELECT
    z.ZIP_CODE,
    z.PO_NAME AS ZIP_NAME,
    z.POPULATION,
    z.SQMI AS ZIP_AREA_SQMILES,
    z.ZIP_CODE_GEOGRAPHY,
    INITCAP(coalesce(p.PRIMARY_FIRE,f.FIRE_NAME)) as FIRE_NAME, -- Use COALESCE to get the primary fire name or the fire name from the perimeter data
    -- Fire perimeter data
    f.FIRE_DISCOVERY_DATETIME,
    f.FIRE_ACRES,
    f.OVERLAP_AREA_SQMILES AS FIRE_OVERLAP_SQMILES,
    f.PERCENT_OF_ZIP_AFFECTED AS FIRE_PERCENT_OF_ZIP,

    -- Evacuation zone data
    e.EVAC_ORDR_SQMILES,
    e.EVAC_ORDR_PCT_ZIP,
    e.EVAC_WRN_SQMILES,
    e.EVAC_WRN_PCT_ZIP,

    -- Building damage data
    b.DESTROYED_BUILDINGS,
    b.MAJOR_DAMAGE_BUILDINGS,
    b.MINOR_DAMAGE_BUILDINGS,
    b.AFFECTED_BUILDINGS,
    b.ANY_DAMAGE_BUILDINGS
FROM {{ ref('stg_ca_zips') }} z
LEFT JOIN {{ ref('int_fire_perimeter_overlap_by_zip') }} f ON  z.ZIP_CODE = f.ZIP_CODE
LEFT JOIN {{ ref('int_evac_zone_overlap_by_zip') }} e ON z.ZIP_CODE = e.ZIP_CODE
LEFT JOIN {{ ref('int_building_damage_by_zip') }} b ON z.ZIP_CODE = b.ZIP_CODE
LEFT JOIN {{ ref('int_primary_fire_by_zip') }} p ON z.ZIP_CODE = p.ZIP_CODE
ORDER BY
    COALESCE(f.PERCENT_OF_ZIP_AFFECTED, 0) DESC,
    COALESCE(e.EVAC_ORDR_PCT_ZIP, 0) + COALESCE(e.EVAC_WRN_PCT_ZIP, 0) DESC,
    COALESCE(b.ANY_DAMAGE_BUILDINGS, 0) DESC
