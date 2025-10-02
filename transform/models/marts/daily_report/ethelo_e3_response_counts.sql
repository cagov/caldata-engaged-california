with responses as (
    select * from {{ ref('int_participant_survey_responses') }}
),

--NOTE: count of participants per department is being deprioritized for now because the metric
--is not well defined and may not provide any value.
--if this is revisited, we need to define how to count the multiple methods of department selection
dept_count as (
    select
        0 as num_participants,  -- placeholder until we define how to handle departments
        --count(distinct participant_id) as num_participants,
        'department' as response_type,
        'N/A' as response_value
        --department_list as response_value
    from responses
    group by all
),

--count of participants per position type dropdown response
pos_count as (
    select
        count(distinct participant_id) as num_participants,
        'position' as response_type,
        pos_type as response_value
    from responses
    group by all
),


--count of participants per tenure dropdown response
tenure as (
    select
        count(distinct participant_id) as num_participants,
        'tenure' as response_type,
        ca_tenure as response_value
    from responses
    group by all
)

select * from dept_count
union all
select * from pos_count
union all
select * from tenure
