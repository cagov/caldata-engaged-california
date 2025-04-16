with source_data as (
    select * from {{ source('GOOGLE_ANALYTICS', 'last_click_sources_by_page_views') }}
    where page_location ilike '%engaged.ca.gov%'
),

last_click_sources_by_page_views as (
 select 
   last_click_sources as sources,
   total_page_views
 from source_data
 
)

select * from last_click_sources_by_page_views