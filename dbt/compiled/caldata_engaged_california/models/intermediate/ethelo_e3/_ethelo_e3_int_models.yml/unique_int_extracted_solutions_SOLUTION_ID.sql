
    
    

select
    SOLUTION_ID as unique_field,
    count(*) as n_records

from TRANSFORM_ENGCA_PRD.ethelo_e3.int_extracted_solutions
where SOLUTION_ID is not null
group by SOLUTION_ID
having count(*) > 1


