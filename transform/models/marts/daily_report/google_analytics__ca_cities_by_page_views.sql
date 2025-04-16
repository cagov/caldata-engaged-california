with source_data as (
    select * from {{ source('GOOGLE_ANALYTICS', 'ca_cities_by_page_views') }}
    where page_location ilike '%engaged.ca.gov%'
),

cities_by_page_views as (
 select 
   geo_city,
   total_page_views
 from source_data
 
)

select * from cities_by_page_views