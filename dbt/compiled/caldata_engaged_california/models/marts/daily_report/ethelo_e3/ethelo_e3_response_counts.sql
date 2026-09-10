with responses as (
    select * from TRANSFORM_ENGCA_PRD.ethelo_e3.int_participant_survey_responses
),

participant_departments as (
    select
        posted_by_id,
        array_distinct(
            array_flatten(
                array_agg(department_user_ai_combined)
            )
        ) as departments
    from TRANSFORM_ENGCA_PRD.ethelo_e3.int_comment_department
    group by posted_by_id
),

--count of responses per department
dept_count as (
    select
        count(*) as metric_value,
        'response count by department' as metric_type,
        f.value::string as response_value
    from participant_departments as pd,
        lateral flatten(pd.departments) as f
    group by all
),

--count of participants per position type dropdown response
pos_count as (
    select
        count(distinct participant_id) as metric_value,
        'participant count by position' as metric_type,
        pos_type as response_value
    from responses
    group by all
),


--count of participants per tenure dropdown response
tenure as (
    select
        count(distinct participant_id) as metric_value,
        'participant count by tenure' as metric_type,
        ca_tenure as response_value
    from responses
    group by all
)

select * from dept_count
union all
select * from pos_count
union all
select * from tenure