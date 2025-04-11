SELECT
    z.ZIP_CODE,
    -- Count by damage category
    COUNT_IF(b.DAMAGE = 'Destroyed (>50%)') AS DESTROYED_BUILDINGS,
    COUNT_IF(b.DAMAGE = 'Major (26-50%)') AS MAJOR_DAMAGE_BUILDINGS,
    COUNT_IF(b.DAMAGE = 'Minor (10-25%)') AS MINOR_DAMAGE_BUILDINGS,
    COUNT_IF(b.DAMAGE = 'Affected (1-9%)') AS AFFECTED_BUILDINGS,
    -- Count all buildings with any damage
    COUNT_IF(b.DAMAGE IN ('Destroyed (>50%)', 'Major (26-50%)', 'Minor (10-25%)', 'Affected (1-9%)')) AS ANY_DAMAGE_BUILDINGS,

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
