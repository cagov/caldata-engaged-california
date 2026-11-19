SELECT
    z.zip_code,
    -- Count by damage category
    COUNT_IF(b.damage = 'Destroyed (>50%)') AS destroyed_buildings,
    COUNT_IF(b.damage = 'Major (26-50%)') AS major_damage_buildings,
    COUNT_IF(b.damage = 'Minor (10-25%)') AS minor_damage_buildings,
    COUNT_IF(b.damage = 'Affected (1-9%)') AS affected_buildings,
    -- Count all buildings with any damage
    COUNT_IF(b.damage IN ('Destroyed (>50%)', 'Major (26-50%)', 'Minor (10-25%)', 'Affected (1-9%)'))
        AS any_damage_buildings

FROM
    TRANSFORM_ENGCA_PRD.ethelo.stg_ca_zips AS z
INNER JOIN
    TRANSFORM_ENGCA_PRD.ethelo.stg_building_damage AS b
    ON
        ST_INTERSECTS(z.zip_code_geography, b.building_geography)
GROUP BY
    z.zip_code, z.po_name, z.population
ORDER BY
    destroyed_buildings DESC, any_damage_buildings DESC