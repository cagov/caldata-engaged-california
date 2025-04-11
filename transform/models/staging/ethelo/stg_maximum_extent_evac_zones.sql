{{ config(materialized='table') }}

WITH source_seed AS (

    -- Source is the seed table created from maximum_extent_evacuation_zones.csv
    SELECT *
    FROM {{ ref('maximum_extent_evacuation_zones') }}

)

SELECT
    -- Attributes from the seed table
    OBJECTID,
    ZONEID,
    COUNTRY_ABBR,
    STATE_ABBR,
    COUNTY_ABB,
    CITY_ABBR,
    ZONE_SEQUENCE,
    CITY_ZONE_SEQUENCE,
    INCIDENT_NAME,
    MOST_EXTREME_STATUS,

    -- Geometry Processing
    WKT_GEOMETRY,
    TRY_TO_GEOGRAPHY(WKT_GEOMETRY) AS zone_geography  -- Convert WKT string to GEOGRAPHY type

FROM source_seed

WHERE WKT_GEOMETRY IS NOT NULL
  AND zone_geography IS NOT NULL