with

source as (
    select * from RAW_ENGCA_PRD.ZOOM.UNMATCHED_PARTICIPANTS
)

select
    invitee_email,
    staff_or_moderator,
    survey_respondent_id_match,
    email_match,
    sortition_round
from source