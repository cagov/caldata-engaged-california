{% macro drop_stale_pr_schemas(database_name, open_pr_numbers=[], max_age_days=14) %}

{#
  Drops GH_CI_PR_[<number>][_<suffix>] schemas in `database_name` when a numbered
  PR is not in `open_pr_numbers` (closed or deleted). Numberless schemas are dropped
  when they were created more than `max_age_days` ago.

  dbt run-operation drop_stale_pr_schemas --args '{database_name: ANALYTICS_ENGCA_DEV, open_pr_numbers: [12, 15]}'
#}

{% if execute %}
  {% set open_prs = open_pr_numbers | map('int') | list %}

  {% set get_schemas %}
    select
      schema_name,
      nullif(regexp_substr(schema_name, '^GH_CI_PR_([0-9]+)?(_|$)', 1, 1, 'e', 1), '')::int as pr_number,
      created < dateadd(day, -{{ max_age_days | int }}, current_timestamp()) as is_old
    from "{{ database_name | upper }}".information_schema.schemata
    where regexp_like(schema_name, '^GH_CI_PR_([0-9]+)?(_.*)?$')
  {% endset %}

  {% set dropped = [] %}
  {% for row in run_query(get_schemas) %}
    {% if (row[1] is not none and row[1] not in open_prs) or (row[1] is none and row[2]) %}
      {{ log("Dropping stale schema: " ~ row[0] ~ " in database: " ~ database_name, info=True) }}
      {% do adapter.drop_schema(api.Relation.create(database=database_name, schema=row[0])) %}
      {% do dropped.append(row[0]) %}
    {% endif %}
  {% endfor %}

  {{ log("Finished cleanup. Dropped " ~ dropped | length ~ " schemas.", info=True) }}
{% endif %}

{% endmacro %}
