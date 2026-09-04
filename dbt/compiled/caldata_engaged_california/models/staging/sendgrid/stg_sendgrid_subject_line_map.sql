with
subjects as (
    select
        msg_id,
        short_id,
        subject as subject_line,
        _load_date,
        _loaded_at
    from RAW_ENGCA_PRD.SENDGRID.MESSAGE_SUBJECTS
)


select * from subjects