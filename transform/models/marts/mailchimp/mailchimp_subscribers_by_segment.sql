
select 
   sum(la_fires_palisades) as total_subscribed_la_fires_palisades,
   sum(la_fires_eaton) as total_subscribed_la_fires_eaton,
   sum(future_topics) as total_subscribed_future_topics,
   sum(la_fires_both) as total_subscribed_la_fires_both,
   sum(future_topics_only) as total_subscribed_future_topics_only
   from {{ ref('int_mailchimp_subscribed_segment_members') }}


