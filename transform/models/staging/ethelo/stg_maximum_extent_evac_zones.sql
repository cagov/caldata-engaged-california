{{ config(materialized='table') }}

WITH source_seed AS (

    -- Source is the seed table created from maximum_extent_evacuation_zones.csv
    SELECT *
    FROM {{ ref('maximum_extent_evacuation_zones') }}

)

SELECT
    -- Attributes from the seed table
    objectid,
    zoneid,
    country_abbr,
    state_abbr,
    county_abb,
    city_abbr,
    zone_sequence,
    city_zone_sequence,
    incident_name,
    most_extreme_status,

    -- Geometry Processing
    wkt_geometry,
    TRY_TO_GEOGRAPHY(wkt_geometry) AS zone_geography  -- Convert WKT string to GEOGRAPHY type

FROM source_seed

WHERE
    wkt_geometry IS NOT NULL
    AND zone_geography IS NOT NULL
