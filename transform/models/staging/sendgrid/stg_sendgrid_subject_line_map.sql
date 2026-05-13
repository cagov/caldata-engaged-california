with
subjects as (
    select 
        msg_id, 
        short_id, 
        subject as subject_line, 
        _load_date, 
        _loaded_at 
    from {{ source('SENDGRID_API','MESSAGE_SUBJECTS') }}
)


select * from subjects 