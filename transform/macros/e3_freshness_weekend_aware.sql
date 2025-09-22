
{% macro test_e3_freshness_weekend_aware(model, column_name=None, error_after_days=1) -%}
{# Weekend-aware freshness test: fail when age_days > effective_error (Mon => +1); skip weekends. #}

{% set col = column_name or '_MODIFIED' %}
{% set error = error_after_days | int %}

with latest as (
  select max({{ adapter.quote(col) }}) as last_modified
  from {{ model }}
), age as (
  select
    last_modified,
    datediff('second', last_modified, current_timestamp())/86400.0 as age_days,
    date_part('dow', current_timestamp()) as dow
  from latest
), params as (
  select {{ error }} as error_after
)
select
  a.last_modified as failing_last_modified,
  a.age_days as failing_age_days,
  (case when a.dow = 1 then p.error_after + 1 else p.error_after end) as effective_error_after,
  'error' as status
from age a cross join params p
where a.age_days > (case when a.dow = 1 then p.error_after + 1 else p.error_after end)
  and a.dow between 1 and 5

{% endmacro %}
