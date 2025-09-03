-- noqa: disable=LT05
{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['comment_id'],
    on_schema_change='fail'
) }}

-- Extract solutions from E3 comments using Snowflake LLM functionality
-- This model runs incrementally to only process new data
with source_comments as (
    select
        sc.comment_id,
        sc.reply_to_id,
        sc.participant_id,
        sc.content,
        sc.question,
        sc.posted_on,
        sc._file_upload_date
    from {{ ref('int_ethelo_e3_comments_and_responses') }} as sc
    where
        sc.content is not null
        and trim(sc.content) != ''
        and sc.posted_on >= '2025-08-15'  -- Filter to relevant date range

    {% if is_incremental() %}
        -- Only process new records since last run
        and (
            sc.posted_on > (select max(t.posted_on) from {{ this }} as t)
        )
    {% endif %}
    order by sc.posted_on desc
),

-- Get comment threads to analyze solutions in context of original comments and replies
comment_threads as (
    select
        c.comment_id,
        c.reply_to_id,
        c.participant_id,
        c.content,
        c.question,
        c.posted_on,
        c._file_upload_date,
        -- Include the parent comment content for context
        p.content as parent_comment_content,
        p.question as parent_question,
        p.comment_id as parent_comment_id
    from source_comments as c
    left join source_comments as p on c.reply_to_id = p.comment_id
),

-- Use AI to extract solutions from each comment
solution_extraction as (
    select
        ct.comment_id,
        ct.reply_to_id,
        ct.participant_id,
        ct.content,
        ct.question,
        ct.posted_on,
        ct._file_upload_date,
        ct.parent_comment_id,

        -- Extract solutions using Snowflake Cortex AI
        try_parse_json(
            ai_complete(
                model => '{{ var("llm_model") }}',
                prompt => concat(
                    'You are analyzing comments from California state employees about government efficiency. ',
                    'Extract the PRIMARY solutions described in this comment as concise summaries that preserve key details.\n\n',
                    'Extract ONLY the solutions, recommendations, and proposed improvements. Ignore problem descriptions\n\n',

                    'COMMENT CONTEXT:\n',
                    'Question/Prompt: ', coalesce(ct.question, '[No context]'), '\n',
                    'Comment Content: ', ct.content, '\n',
                    case
                        when ct.parent_comment_content is not null
                            then
                                concat('Parent Comment (this is a reply): ', ct.parent_comment_content, '\n')
                        else ''
                    end,
                    '\n',

                    'GUIDELINES:\n',
                    '• Identify main solutions and recommendations, not minor suggestions\n',
                    '• Preserve specific program names, systems, and technologies mentioned\n',
                    '• CONSOLIDATE complementary steps in one implementation; SEPARATE independent recommendations requiring different decision-makers\n',
                    '• One solution = one actionable recommendation for leadership\n\n',
                    '• Summarize comprehensively but as concisely as possible\n',
                    '• Focus on substantial, actionable solutions\n\n',
                    '• if a comment does not contain a solution, return an empty JSON object\n\n',

                    'EXAMPLES OF COMPREHENSIVE EXTRACTION:\n',
                    'Input: "There needs to be a better process for getting duplicate pay warrants issued. I often have employees waiting a month or more just to receive a replacement warrant. This delay is really frustrating for employees who need their pay and creates extra work for managers who have to field complaints. I like Cal Employee Connect but I think they could add functionality to it, giving the employee the ability to request their own duplicate warrant directly with the SCO."\n',
                    'Output: "Add functionality to Cal Employee Connect allowing employees to request duplicate pay warrants directly with State Controllers Office (SCO) to reduce processing time"\n\n',

                    'Input: "CDCR Fire needs a complete reorganization. Currently, multiple fire stations operate independently, answering to Plant Operations or Wardens. Each station procures its own PPE, hoses, tools, and follows local policies—resulting in a fragmented system with no standardization or unified effectiveness. A centralized command starting in Sacramento is essential. Appointing a Fire Chief and Deputy Chief, supported by three Division Chiefs (North, Central, South), would create statewide oversight. Each fire station would have a Battalion Chief supervising Fire Captains, ensuring consistency and accountability."\n',
                    'Output: "Establish centralized California Department of Corrections and Rehabilitation (CDCR) Fire command in Sacramento with Fire Chief, Deputy Chief, and three Division Chiefs (North, Central, South) overseeing Battalion Chiefs at each station to create standardized operations and unified effectiveness"\n\n',

                    'Remember: one solution = one actionable recommendation for leadership. Return exactly 1 consolidated solution per comment unless the source comment contains multiple, truly unique solutions.'
                ),
                -- use lower temp and top_p to reduce the stochastic nature of LLM output.
                model_parameters => object_construct(
                    'temperature', 0.1,
                    'max_tokens', 1500,
                    'top_p', 0.1
                ),
                response_format => {
                    'type': 'json',
                    'schema': {
                        'type': 'object',
                        'properties': {
                            'solutions': {
                                'type': 'array',
                                'items': { 'type': 'string' }
                            }
                        },
                        'required': ['solutions']
                    }
                }
            )
        ) as solutions_json
    from comment_threads as ct
),

-- Flatten the solutions array to create one row per solution
flattened_solutions as (
    select
        se.comment_id,
        se.reply_to_id,
        se.participant_id,
        se.content,
        se.question,
        se.posted_on,
        se._file_upload_date,
        se.parent_comment_id,
        se.solutions_json,

        -- Extract solutions array
        case
            when se.solutions_json:solutions is not null
                then se.solutions_json:solutions
            else []
        end as solutions_array,

        -- Generate solution sequence numbers
        row_number() over (
            partition by se.comment_id
            order by f.value
        ) as solution_sequence,

        -- Extract individual solution text
        f.value::string as solution_text

    from solution_extraction as se,
        lateral flatten(input => solutions_array, outer => true) as f
    where f.value is not null and trim(f.value::string) != ''
)

select
    -- Primary key components for incremental updates
    comment_id,
    participant_id,
    posted_on,
    solution_sequence,

    -- Source comment details
    reply_to_id,
    parent_comment_id,  -- For linking solutions to original problem discussions
    content as source_comment,
    question as source_question,
    _file_upload_date,

    -- Extracted solution information
    solution_text,
    length(solution_text) as solution_length,

    -- AI processing metadata
    solutions_json,
    case
        when solutions_json is not null then 'SUCCESS'
        else 'FAILED'
    end as extraction_status,

    -- Processing timestamp
    current_timestamp() as processed_at

from flattened_solutions
where solution_text is not null
