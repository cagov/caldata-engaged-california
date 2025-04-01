{{ config(materialized='table') }}

WITH source_seed AS (
    -- Source table created by dbt seed from buildings_with_dins_2023.csv
    SELECT *
    FROM {{ ref('buildings_with_dins_2023') }} 
)

SELECT
    -- Attributes from the seed table
    OBJECTID,
    CODE,
    BLD_ID,
    HEIGHT,
    ELEV,
    SOURCE,
    DATE_ AS DATE,
    STATUS,
    OLD_BLD_ID,
    AREA,
    DAMAGE,
    STRUCTURET AS STRUCTURE_TYPE,
    SHAPE__AREA as SHAPE_AREA,
    SHAPE__LENGTH as SHAPE_LENGTH,

    -- Geometry Processing
    WKT_GEOMETRY,
    TRY_TO_GEOGRAPHY(WKT_GEOMETRY) AS building_geography 

FROM source_seed

WHERE WKT_GEOMETRY IS NOT NULL
  AND building_geography IS NOT NULL