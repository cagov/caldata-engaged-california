SELECT 
    z.ZIP_CODE,
    -- Count by damage category
    SUM(CASE WHEN b.DAMAGE = 'Destroyed (>50%)' THEN 1 ELSE 0 END) AS DESTROYED_BUILDINGS,
    SUM(CASE WHEN b.DAMAGE = 'Major (26-50%)' THEN 1 ELSE 0 END) AS MAJOR_DAMAGE_BUILDINGS,
    SUM(CASE WHEN b.DAMAGE = 'Minor (10-25%)' THEN 1 ELSE 0 END) AS MINOR_DAMAGE_BUILDINGS,
    SUM(CASE WHEN b.DAMAGE = 'Affected (1-9%)' THEN 1 ELSE 0 END) AS AFFECTED_BUILDINGS,
    -- Count all buildings with any damage
    SUM(CASE WHEN b.DAMAGE IN ('Destroyed (>50%)', 'Major (26-50%)', 'Minor (10-25%)', 'Affected (1-9%)') THEN 1 ELSE 0 END) AS ANY_DAMAGE_BUILDINGS,

FROM 
    {{ ref('stg_ca_zips') }} z
JOIN 
    {{ ref('stg_building_damage') }} b
ON 
    ST_INTERSECTS(z.ZIP_CODE_GEOGRAPHY, b.BUILDING_GEOGRAPHY)
GROUP BY 
    z.ZIP_CODE, z.PO_NAME, z.POPULATION
ORDER BY 
    DESTROYED_BUILDINGS DESC, ANY_DAMAGE_BUILDINGS DESC