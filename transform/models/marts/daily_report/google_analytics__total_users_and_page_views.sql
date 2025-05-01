with source_data as (
    select * from {{ source('GOOGLE_ANALYTICS', 'total_users_and_page_views') }}
    where page_location ilike '%engaged.ca.gov%'
),

totals as (
      select
         total_page_views,
         total_users
      from source_data

),

la_totals as (
      select total_users as total_users_la
      from source_data
      where geo_city = 'Los Angeles'

)

select * from totals, la_totals
