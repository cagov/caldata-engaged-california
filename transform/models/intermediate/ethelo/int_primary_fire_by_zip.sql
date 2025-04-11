-- This model identifies the primary fire incident affecting each ZIP code based on the maximum extent of evacuation zones.
-- It calculates the overlap between ZIP codes and evacuation zones, ranks them, and selects the primary fire incident for each ZIP code.
-- Some zip codes were affected by multiple evacuation zones, so we need to select the one with the highest overlap.
{{ config(materialized='view') }}
WITH intersection_areas AS (
    SELECT
        z.ZIP_CODE,
        z.PO_NAME,
        z.SQMI AS ZIP_AREA_SQMILES,
        e.MOST_EXTREME_STATUS,
        e.INCIDENT_NAME,
        ST_AREA(ST_INTERSECTION(z.ZIP_CODE_GEOGRAPHY, e.ZONE_GEOGRAPHY)) / 2589988.11 AS OVERLAP_SQMILES,
        (ST_AREA(ST_INTERSECTION(z.ZIP_CODE_GEOGRAPHY, e.ZONE_GEOGRAPHY)) / ST_AREA(z.ZIP_CODE_GEOGRAPHY)) * 100 AS PERCENT_OVERLAP
    FROM
        {{ ref('stg_ca_zips') }} z
    JOIN
        {{ ref('stg_maximum_extent_evac_zones') }} e
    ON
        ST_INTERSECTS(z.ZIP_CODE_GEOGRAPHY, e.ZONE_GEOGRAPHY)
),
status_aggregates AS (
    SELECT
        ZIP_CODE,
        PO_NAME,
        ZIP_AREA_SQMILES,
        MOST_EXTREME_STATUS,
        INCIDENT_NAME,
        SUM(OVERLAP_SQMILES) AS TOTAL_OVERLAP_SQMILES,
        SUM(PERCENT_OVERLAP) AS TOTAL_PERCENT_OVERLAP
    FROM
        intersection_areas
    GROUP BY
        ZIP_CODE, PO_NAME, ZIP_AREA_SQMILES, MOST_EXTREME_STATUS, INCIDENT_NAME
),
ranked_results AS (
    SELECT 
        INCIDENT_NAME,
        ZIP_CODE,
        TOTAL_PERCENT_OVERLAP,
        RANK() OVER (PARTITION BY ZIP_CODE ORDER BY TOTAL_PERCENT_OVERLAP DESC) as size_rank 
    FROM status_aggregates
    WHERE MOST_EXTREME_STATUS = 'Evacuation Order'
)
SELECT 
    
    ZIP_CODE,
    INCIDENT_NAME as PRIMARY_FIRE
FROM ranked_results
WHERE size_rank = 1
