with

source as (
    select * from RAW_ENGCA_PRD.ZOOM.UNMATCHED_PARTICIPANTS
)

select
    invitee_email,
    md5(lower(trim(invitee_email))) as invitee_email_hash,
    staff_or_moderator,
    survey_respondent_id_match,
    email_match,
    -- email_match holds either the matched Go Vocal profile's address or a status string such as
    -- 'could not match'. Replace any address with 'matched' so downstream models can keep the status
    -- without carrying an email.
    iff(email_match like '%@%', 'matched', email_match) as email_match_status,
    sortition_round
from source