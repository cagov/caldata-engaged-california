-- Calculate all ZIP-evacuation zone intersections first
WITH intersection_areas AS (
    SELECT
        z.zip_code,
        z.po_name,
        z.sqmi AS zip_area_sqmiles,
        e.most_extreme_status,
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

-- Group and aggregate by ZIP code and evacuation status
status_aggregates AS (
    SELECT
        zip_code,
        po_name,
        zip_area_sqmiles,
        most_extreme_status,
        SUM(overlap_sqmiles) AS total_overlap_sqmiles,
        SUM(percent_overlap) AS total_percent_overlap
    FROM
        intersection_areas
    GROUP BY
        zip_code, po_name, zip_area_sqmiles, most_extreme_status
)

-- Pivot the results to have separate columns for each status
SELECT
    z.zip_code,
    z.po_name AS zip_name,
    z.sqmi AS zip_area_sqmiles,
    COALESCE(MAX(CASE WHEN s.most_extreme_status = 'Evacuation Order' THEN s.total_overlap_sqmiles END), 0)
        AS evac_ordr_sqmiles,
    COALESCE(MAX(CASE WHEN s.most_extreme_status = 'Evacuation Order' THEN s.total_percent_overlap END), 0)
        AS evac_ordr_pct_zip,
    COALESCE(MAX(CASE WHEN s.most_extreme_status = 'Evacuation Warning' THEN s.total_overlap_sqmiles END), 0)
        AS evac_wrn_sqmiles,
    COALESCE(MAX(CASE WHEN s.most_extreme_status = 'Evacuation Warning' THEN s.total_percent_overlap END), 0)
        AS evac_wrn_pct_zip
FROM
    {{ ref('stg_ca_zips') }} AS z
LEFT JOIN
    status_aggregates AS s
    ON
        z.zip_code = s.zip_code
GROUP BY
    z.zip_code, z.po_name, z.sqmi
ORDER BY
    (
        COALESCE(MAX(CASE WHEN s.most_extreme_status = 'Evacuation Order' THEN s.total_percent_overlap END), 0)
        + COALESCE(MAX(CASE WHEN s.most_extreme_status = 'Evacuation Warning' THEN s.total_percent_overlap END), 0)
    ) DESC,
    COALESCE(MAX(CASE WHEN s.most_extreme_status = 'Evacuation Order' THEN s.total_percent_overlap END), 0) DESC
