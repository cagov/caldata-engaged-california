select
    sum(case when segments like '%eaton%' then total_subscribers else 0 end) as eaton_total,
    sum(case when segments like '%palisades%' then total_subscribers else 0 end) as palisades_total,
    sum(case when (
        segments like '%eaton%'
        or segments like '%palisades%'
    ) then total_subscribers
    else 0 end) as eaton_or_palisades_total,
    sum(case when segments like '%future%' then total_subscribers else 0 end) as future_topics,
    sum(case when (
        segments like '%future%'
        and segments not like '%palisades%'
        and segments not like '%eaton%'
    ) then total_subscribers
    else 0 end) as future_topics_only

from {{ ref('mailchimp_subscribers_by_segment') }}
