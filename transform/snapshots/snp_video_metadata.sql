{% snapshot snp_video_metadata %}

{{
    config(
        target_schema='snapshots',
        unique_key='id',
        strategy='check',
        check_cols=['snippet_title', 'snippet_description', 'snippet_tags', 'privacy_status', 'content_details_duration']
    )
}}

    select * from {{ source('YOUTUBE_ANALYTICS', 'VIDEO') }}

{% endsnapshot %}
