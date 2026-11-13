
    
    

select
    last_updated_date as unique_field,
    count(*) as n_records

from TRANSFORM_ENGCA_PRD.social.stg_instagram__subscribers
where last_updated_date is not null
group by last_updated_date
having count(*) > 1


