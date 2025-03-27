select 
    sum(case when segments like '%eaton%' then total_subscribers else 0 end) as Eaton_Total,
    sum(case when segments like '%palisades%' then total_subscribers else 0 end) as Palisades_Total, 
    sum(case when (segments like '%eaton%' 
        or segments like '%palisades%') then total_subscribers else 0 end) as Eaton_or_Palisades_Total,
    sum(case when segments like '%future%' then total_subscribers else 0 end) as Future_Topics,
    sum(case when (segments like '%future%' 
        and segments not like '%palisades%' 
        and segments not like '%eaton%') then total_subscribers else 0 end) as Future_Topics_Only

 from {{ ref('mailchimp_subscribers_by_segment')}}