{#
    Pseudonymous key for an email address: md5 of the lower-cased, trimmed value.

    Every model that needs to join people across sources must hash with this macro
    so the keys agree. Raw email addresses stay in staging models only; intermediate and mart
    models carry the hash. Null emails hash to null.
#}
{% macro hash_email(column) -%}
    md5(lower(trim({{ column }})))
{%- endmacro %}
