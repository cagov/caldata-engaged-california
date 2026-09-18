{%- macro format_hms(seconds_expr) -%}
lpad(floor(({{ seconds_expr }}) / 3600)::int, 2, '0') || ':'
    || lpad(floor(mod({{ seconds_expr }}, 3600) / 60)::int, 2, '0') || ':'
    || lpad(floor(mod({{ seconds_expr }}, 60))::int, 2, '0')
{%- endmacro -%}
