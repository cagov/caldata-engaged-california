with recent_fire_perimeters as (
    select
        * exclude (perimeter_geography),
        TO_GEOGRAPHY(perimeter_geography) as perimeter_geography
    from
        {{ ref('stg_ca_fire_perimeters') }}
)

select
    z.zip_code,
    z.po_name as zip_name,
    f.poly_incidentname as fire_name,
    f.fire_discovery_datetime,
    f.poly_gisacres as fire_acres,
    z.sqmi as zip_area_sqmiles,
    ST_AREA(ST_INTERSECTION(z.zip_code_geography, f.perimeter_geography)) / 2589988.11 as overlap_area_sqmiles,
    (ST_AREA(ST_INTERSECTION(z.zip_code_geography, f.perimeter_geography)) / ST_AREA(z.zip_code_geography))
    * 100 as percent_of_zip_affected,
    ROW_NUMBER()
        over (
            partition by z.zip_code
            order by ST_AREA(ST_INTERSECTION(z.zip_code_geography, f.perimeter_geography)) desc
        )
        as fire_rank
from
    {{ ref('stg_ca_zips') }} as z
inner join
    recent_fire_perimeters as f
    on
        ST_INTERSECTS(z.zip_code_geography, f.perimeter_geography)
qualify fire_rank = 1
