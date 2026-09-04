
    
    

with all_values as (

    select
        section as value_field,
        count(*) as n_records

    from ANALYTICS_ENGCA_PRD.ai_engagement.phase2_transcript_session_summaries
    group by section

)

select *
from all_values
where value_field not in (
    'overview','protect_themes','gov_action_themes','general_themes','areas_of_tension','areas_of_consensus','deliberative_moments'
)


