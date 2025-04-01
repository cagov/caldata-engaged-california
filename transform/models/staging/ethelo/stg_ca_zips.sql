{{ config(materialized='table') }}

WITH source_seed AS (
    -- Reference the seed table created from california_zip_codes.csv
    SELECT *
    FROM {{ ref('california_zip_codes') }}
)

SELECT
    OBJECTID,
    ZIP_CODE,
    PO_NAME,
    STATE,
    NULLIF(POPULATION, -99) as POPULATION, 
    POP_SQMI,
    SQMI,

    -- Geometry processing: Convert WKT to GEOGRAPHY
    WKT_GEOMETRY,                                
    TRY_TO_GEOGRAPHY(WKT_GEOMETRY) AS zip_code_geography 

FROM source_seed

WHERE WKT_GEOMETRY IS NOT NULL                    
  AND zip_code_geography IS NOT NULL              