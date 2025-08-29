with users_odi as (
    select * from {{ source('BITLY', 'USERS') }}
),

users_ci as (
    select * from {{ source('BITLY_CALINNOVATE', 'USERS') }}
),

users_union as (
    select * from users_odi
    union distinct
    select * from users_ci
)

select distinct
    login,
    name
from users_union
where _fivetran_deleted = FALSE
