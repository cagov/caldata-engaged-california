SELECT
    z.zip_code,
    z.po_name AS zip_name,
    f.name AS fire_name,
    f.fire_discovery_datetime,
    f.acres AS fire_acres,
    z.sqmi AS zip_area_sqmiles,
    ST_AREA(ST_INTERSECTION(z.zip_code_geography, f.perimeter_geography)) / 2589988.11 AS overlap_area_sqmiles,
    (ST_AREA(ST_INTERSECTION(z.zip_code_geography, f.perimeter_geography)) / ST_AREA(z.zip_code_geography))
    * 100 AS percent_of_zip_affected,
    ROW_NUMBER()
        OVER (
            PARTITION BY z.zip_code
            ORDER BY ST_AREA(ST_INTERSECTION(z.zip_code_geography, f.perimeter_geography)) DESC
        )
        AS fire_rank
FROM
    {{ ref('stg_ca_zips') }} AS z
INNER JOIN
    {{ ref('recent_fire_perimeters') }} AS f
    ON
        ST_INTERSECTS(z.zip_code_geography, f.perimeter_geography)
QUALIFY fire_rank = 1
