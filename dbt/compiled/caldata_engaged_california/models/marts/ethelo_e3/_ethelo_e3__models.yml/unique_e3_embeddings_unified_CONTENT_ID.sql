
    
    

select
    CONTENT_ID as unique_field,
    count(*) as n_records

from ANALYTICS_ENGCA_PRD.ethelo_e3.e3_embeddings_unified
where CONTENT_ID is not null
group by CONTENT_ID
having count(*) > 1


