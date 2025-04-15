{{ config(materialized='table') }}

WITH source_seed AS (
    -- Source table created by dbt seed from buildings_with_dins_2023.csv
    SELECT *
    FROM {{ ref('buildings_with_dins_2023') }}
)

SELECT
    -- Attributes from the seed table
    objectid,
    code,
    bld_id,
    height,
    elev,
    source,
    date_ AS date,
    status,
    old_bld_id,
    area,
    damage,
    structuret AS structure_type,
    shape__area AS shape_area,
    shape__length AS shape_length,

    -- Geometry Processing
    wkt_geometry,
    TRY_TO_GEOGRAPHY(wkt_geometry) AS building_geography

FROM source_seed

WHERE
    wkt_geometry IS NOT NULL
    AND building_geography IS NOT NULL
