select
    sum(case when segments like '%eaton%' then total_subscribers else 0 end) as eaton_total,
    sum(case when segments like '%palisades%' then total_subscribers else 0 end) as palisades_total,
    sum(case when (
        segments like '%eaton%'
        and segments like '%palisades%'
    ) then total_subscribers
    else 0 end) as eaton_and_palisades_total,
    sum(case when segments like '%future%' then total_subscribers else 0 end) as future_topics,
    sum(case when (
        segments like '%future%'
        and segments not like '%palisades%'
        and segments not like '%eaton%'
        ) then total_subscribers
        else 0 end) as future_topics_only,
    sum(case when segments like '%no-interest%' then total_subscribers else 0 end) as no_interest_total,

from {{ ref('mailchimp_subscribers_by_segment') }}
