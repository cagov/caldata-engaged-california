
    
    

with all_values as (

    select
        CONTENT_TYPE as value_field,
        count(*) as n_records

    from ANALYTICS_ENGCA_PRD.ethelo_e3.e3_embeddings_unified
    group by CONTENT_TYPE

)

select *
from all_values
where value_field not in (
    'Raw Main Idea','Processed Problem & Solution'
)


