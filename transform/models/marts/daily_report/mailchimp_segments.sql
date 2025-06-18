select
    --Phase 1 LA Wildfire Segments:
    sum(case when segments like '%eatonphase1%' then total_subscribers else 0 end) as eaton_phase1_total,
    sum(case when segments like '%palisadesphase1%' then total_subscribers else 0 end) as palisades_phase1_total,
    sum(case when (
        segments like '%eatonphase1%'
        and segments like '%palisadesphase1%'
    ) then total_subscribers
    else 0 end) as eaton_and_palisades_phase1_total,
    sum(case when segments like '%future%' then total_subscribers else 0 end) as future_topics,
    sum(case when (
        segments like '%future%'
        and segments not like '%palisades%'
        and segments not like '%eaton%'
    ) then total_subscribers
    else 0 end) as future_topics_only,

    --Phase 2 LA Wildfire Segments:
    sum(case when segments like '%eatonphase2%' then total_subscribers else 0 end) as eaton_phase2_total,
    sum(case when segments like '%palisadesphase2%' then total_subscribers else 0 end) as palisades_phase2_total,
    sum(case when segments like '%nofirephase2%' then total_subscribers else 0 end) as no_fire_phase2_total,

    -- Subscribed, but no segment:
    sum(case when segments like '%nointerest%' then total_subscribers else 0 end) as no_segment_total,
    max(max_fivetran_sync_date) as max_fivetran_sync_date

from {{ ref('mailchimp_subscribers_by_segment') }}
