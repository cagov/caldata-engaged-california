select
    Name,
    Fire_discovery_datetime,
    Containment_datetime,
    Control_datetime,
    Fire_out_datetime,
    Acres,
    Perimeter_geography
from {{ ref('int_recent_fire_perimeters') }}
