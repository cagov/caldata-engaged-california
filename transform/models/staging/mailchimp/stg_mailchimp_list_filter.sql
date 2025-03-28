{{ config(materialized='ephemeral') }}

select
    id as list_id,
    name as list_name

from {{ source('MAILCHIMP','LIST') }}
where
    _fivetran_deleted = FALSE
    and list_name = 'Engaged California' --this is the list name for the Engaged CA audience in Mailchimp
