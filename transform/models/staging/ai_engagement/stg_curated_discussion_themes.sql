with

seed as (
    select * from {{ ref('curated_discussion_themes') }}
)

select
    -- Manually-assigned stable integer id. This is the incremental grain key of
    -- phase2_transcript_curated_theme_tags, so never renumber existing themes; labels
    -- and descriptions can be reworded without orphaning that model's rows (though a
    -- --full-refresh is still needed to re-tag and refresh the stored text).
    theme_id,
    theme_label,
    theme_description
from seed
