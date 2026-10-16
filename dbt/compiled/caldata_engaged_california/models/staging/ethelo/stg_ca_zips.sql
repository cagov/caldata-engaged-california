

WITH source_seed AS (
    -- Reference the seed table created from california_zip_codes.csv
    SELECT *
    FROM TRANSFORM_ENGCA_PRD.analytics.california_zip_codes
)

SELECT
    objectid,
    zip_code,
    po_name,
    state,
    NULLIF(population, -99) AS population,
    pop_sqmi,
    sqmi,

    -- Geometry processing: Convert WKT to GEOGRAPHY
    wkt_geometry,
    TRY_TO_GEOGRAPHY(wkt_geometry) AS zip_code_geography

FROM source_seed

WHERE
    wkt_geometry IS NOT NULL
    AND zip_code_geography IS NOT NULL