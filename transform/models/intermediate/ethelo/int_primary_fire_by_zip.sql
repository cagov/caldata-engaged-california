-- This model identifies the primary fire incident affecting each ZIP code based on the maximum extent of
-- evacuation zones.
-- It calculates the overlap between ZIP codes and evacuation zones, ranks them, and selects the primary fire
-- incident for each ZIP code.
-- Some zip codes were affected by multiple evacuation zones, so we need to select the one with the highest overlap.
{{ config(materialized='view') }}
WITH intersection_areas AS (
    SELECT
        z.zip_code,
        z.po_name,
        z.sqmi AS zip_area_sqmiles,
        e.most_extreme_status,
        e.incident_name,
        ST_AREA(ST_INTERSECTION(z.zip_code_geography, e.zone_geography)) / 2589988.11 AS overlap_sqmiles,
        (ST_AREA(ST_INTERSECTION(z.zip_code_geography, e.zone_geography)) / ST_AREA(z.zip_code_geography))
        * 100 AS percent_overlap
    FROM
        {{ ref('stg_ca_zips') }} AS z
    INNER JOIN
        {{ ref('stg_maximum_extent_evac_zones') }} AS e
        ON
            ST_INTERSECTS(z.zip_code_geography, e.zone_geography)
),

status_aggregates AS (
    SELECT
        zip_code,
        po_name,
        zip_area_sqmiles,
        most_extreme_status,
        incident_name,
        SUM(overlap_sqmiles) AS total_overlap_sqmiles,
        SUM(percent_overlap) AS total_percent_overlap
    FROM
        intersection_areas
    GROUP BY
        zip_code, po_name, zip_area_sqmiles, most_extreme_status, incident_name
),

ranked_results AS (
    SELECT
        incident_name,
        zip_code,
        total_percent_overlap,
        RANK() OVER (
            PARTITION BY zip_code
            ORDER BY total_percent_overlap DESC
        ) AS size_rank
    FROM status_aggregates
    WHERE most_extreme_status = 'Evacuation Order'
)

SELECT

    zip_code,
    incident_name AS primary_fire
FROM ranked_results
WHERE size_rank = 1
