with final as (

    select * from {{ ref('int_video_daily') }}

)

select * from final
