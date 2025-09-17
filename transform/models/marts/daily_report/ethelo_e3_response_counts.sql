--count of participants per department -- this will need refinement as we clean and fill in dept gaps
with dept_count as (
    select
        count(distinct participant_id) as num_participants,
        'department' as response_type,
        idea_dept as response_value
    from {{ref('e3_participant_responses')}}
    group by all
),

--count of participants per position type dropdown response
pos_count as (
    select
        count(distinct participant_id) as num_participants,
        'position' as response_type,
        pos_type as response_value
    from a{{ref('e3_participant_responses')}}
    group by all
),


--count of participants per tenure dropdown response
tenure as (
    select
        count(distinct participant_id) as num_participants,
        'tenure' as response_type,
        ca_tenure as response_value
    from {{ref('e3_participant_responses')}}
    group by all
)

select * from dept_count
union all
select * from pos_count
union all
select * from tenure
