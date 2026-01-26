with recent_fire_perimeters AS (
    SELECT
        * exclude(perimeter_geography),
        TO_GEOGRAPHY(perimeter_geography) AS perimeter_geography
    FROM
        {{ ref('stg_ca_fire_perimeters') }}
)

SELECT
    z.zip_code,
    z.po_name AS zip_name,
    f.poly_incidentname AS fire_name,
    f.fire_discovery_datetime,
    f.poly_gisacres AS fire_acres,
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
    recent_fire_perimeters AS f
    ON
        ST_INTERSECTS(z.zip_code_geography, f.perimeter_geography)
QUALIFY fire_rank = 1
