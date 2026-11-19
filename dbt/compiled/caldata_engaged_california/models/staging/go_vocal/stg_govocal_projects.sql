with

projects as (select * from RAW_ENGCA_PRD.GOVOCAL.PROJECTS)

select
    id as project_id,
    title,
    description_html,
    description_preview,
    slug,
    folder_id,
    href,
    visible_to,
    images,
    created_at::timestamp_ltz as created_at,
    updated_at::timestamp_ltz as updated_at,
    ideas_count,
    comments_count,
    map_center_geojson,
    publication_status,
    _load_date,
    _loaded_at
from projects