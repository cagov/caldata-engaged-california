with final as (

    select * from {{ ref('int_channel_daily') }}

)

select * from final
