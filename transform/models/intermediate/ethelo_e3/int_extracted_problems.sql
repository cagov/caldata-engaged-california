-- noqa: disable=LT05
{{ config(
    materialized='incremental',
    unique_key=['comment_id', 'participant_id', 'posted_on', 'problem_sequence'],
    on_schema_change='fail'
) }}

-- Extract problems from E3 comments using Snowflake LLM functionality
-- This model runs incrementally to only process new data
-- Get department responses for each participant
with participant_departments as (
    select
        participant_id,
        idea_dept as department_response
    from {{ ref('int_participant_survey_responses') }}
    where
        idea_dept is not null
        and trim(idea_dept) != ''
),

source_comments as (
    select
        c.comment_id,
        c.reply_to_id,
        c.participant_id,
        c.content,
        c.question,
        c.posted_on,
        c._file_upload_date,
        -- Add department context for main ideas, null for replies (to be inferred later)
        case
            when
                c.reply_to_id is null
                and c.question = 'Share your idea - Primary problem and ideas to solve the problem'
                then d.department_response
        end as explicit_department
    from {{ ref('int_ethelo_e3_comments_and_responses') }} as c
    left join participant_departments as d on c.participant_id = d.participant_id
    where
        c.content is not null
        and trim(c.content) != ''
        and c.posted_on >= '2025-08-15'  -- Filter to relevant date range
        -- Exclude survey-only questions from problem extraction
        and c.question not in (
            'Share your idea - Which department or agency does your idea apply to?',
            'Opening question - What makes you proud about your role in public service?',
            'Anything else? - Would you add any other ideas, including from your perspective as a California resident?'
        )

        {% if is_incremental() %}
            -- Only process new records since last run
            and (
                c._file_upload_date > (select max(t._file_upload_date) from {{ this }} as t)
                or c.posted_on > (select max(t.posted_on) from {{ this }} as t)
            )
        {% endif %}
    order by c.posted_on desc
),

-- Use AI to extract problems from each comment
problem_extraction as (
    select
        sc.comment_id,
        sc.reply_to_id,
        sc.participant_id,
        sc.content,
        sc.question,
        sc.posted_on,
        sc._file_upload_date,
        sc.explicit_department,

        -- Extract problems using Snowflake Cortex AI
        try_parse_json(
            ai_complete(
                model => 'claude-4-sonnet',
                prompt => concat(
                    'You are analyzing comments from California state employees about government efficiency. ',
                    'Extract the PRIMARY problems described in this comment as concise summaries that preserve key details.\n\n',
                    'Extract ONLY the problems, issues, and inefficiencies. Ignore proposed solutions.\n',  -- noqa: LT05

                    'COMMENT CONTEXT:\n',
                    'Question/Prompt: ', coalesce(sc.question, '[No context]'), '\n',
                    'Comment Content: ', sc.content, '\n',
                    case
                        when sc.explicit_department is not null
                            then
                                concat('Department/Agency: ', sc.explicit_department, '\n')
                        else ''
                    end,
                    '\n',

                    'GUIDELINES:\n',
                    '• Identify main problems, not minor details\n',
                    '• Preserve specific program names, policies, and systems mentioned\n',
                    '• CONSOLIDATE related issues into comprehensive, higher-level problems\n',
                    '• DO NOT fragment single issues, processes or systems into multiple problems\n',
                    '• If multiple issues stem from the same root cause or system, combine them\n',
                    '• Summarize comprehensively but as concisely as possible\n',
                    '• Focus on substantial, actionable problems\n\n',
                    '• if a comment does not contain a problem or one that cannot be reasonably inferred from the solution, return an empty JSON object\n\n',  -- noqa: LT05

                    case
                        when sc.explicit_department is null
                            then
                                'DEPARTMENT INFERENCE:\n'
                                || '• Extract relevant California state departments based on the comment content\n'
                                || '• Consider DGS, CalHR, SCO, Controller, CalFire, CDCR, GovOps etc.\n\n'
                        else ''
                    end,

                    'EXAMPLES OF COMPREHENSIVE EXTRACTION:\n',
                    'Input: "We are very poorly trained and lack operational consistency. Every office is doing something different, every agency does the same process different ways, there needs to be a smoother process on how we do things in each agency. There are too many hands in the pot, just to get something approved as simple as office supplies, it has a minimum of 5 people processing an order, we are spending more money in labor then what the supply request cost. There should be statewide system for things like procurement, timesheets, basically any common function that is takes to run an agency."\n',  -- noqa: LT05

                    'Output: "Lack of statewide standardized systems for common functions like procurement and timesheets results in every office and agency operating differently, with excessive approval workflows for simple administrative tasks"\n\n',  -- noqa: LT05
                    'Input: "The procurement process is overly complicated, time consuming, and often not the most cost efficient. For example, we are required to purchase chairs from CalPIA. CalPIA charges $500+ for one desk chair and then another $30 per chair to deliver. The same chair could be purchased from another retailer for a fraction of the price. In addition, the ordering time is outrageous. Purchases go through many levels of approval before getting to the vendor and many times the required vendor''s turn around time is 60+ business days. Small businesses and disabled veteran-owned businesses get preference, and many times, these small businesses order from retailers like Amazon and then upcharge the State. There is nothing cost efficient about the procurement process. We should be able to buy small things ourselves without going through CalPIA."\n',  -- noqa: LT05
                    'Output: "Mandatory procurement through CalPIA and preferred small/disabled veteran-owned businesses results in significantly higher costs with additional delivery fees and vendor markups that waste taxpayer funds"\n\n',  -- noqa: LT05
                    'INCORRECT - Fragmentation (DO NOT DO THIS):\n',
                    'Input: [same procurement comment]\n',
                    'Wrong Output: {"problems": [{"problem_text": "CalPIA charges too much for chairs"}, {"problem_text": "Approval process takes too long"}, {"problem_text": "Small businesses mark up prices"}]}\n\n',  -- noqa: LT05


                    'OUTPUT FORMAT:\n',
                    'Return ONLY valid JSON without markdown formatting or code blocks:\n',
                    '{\n',
                    '  "problems": [\n',
                    '    {\n',
                    '      "problem_text": "concise problem summary preserving key details",\n',
                    '      "inferred_departments": ["Department 1", "Department 2"] or null\n',
                    '    }\n',
                    '  ]\n',
                    '}\n',
                    'Do not wrap in ```json or ``` - return raw JSON only.\n',
                    'Return exactly 1 consolidated problem per comment unless the source comment contains multiple, truly unrelated problems.'
                ),
                model_parameters => object_construct(
                    'temperature', 0.1,
                    'max_tokens', 1500,
                    'top_p', 0.1
                )
            )
        ) as problems_json
    from source_comments as sc
),

-- Flatten the problems array to create one row per problem
flattened_problems as (
    select
        pe.comment_id,
        pe.reply_to_id,
        pe.participant_id,
        pe.content,
        pe.question,
        pe.posted_on,
        pe._file_upload_date,
        pe.explicit_department,
        pe.problems_json,

        -- Extract problems array
        case
            when pe.problems_json:problems is not null
                then pe.problems_json:problems
            else []
        end as problems_array,

        -- Generate problem sequence numbers
        row_number() over (
            partition by pe.comment_id, pe.participant_id, pe.posted_on
            order by f.value:problem_text
        ) as problem_sequence,

        -- Extract individual problem text and inferred departments
        f.value:problem_text::string as problem_text,
        f.value:inferred_departments as inferred_departments_array

    from problem_extraction as pe,
        lateral flatten(input => problems_array, outer => true) as f
    where f.value:problem_text is not null and trim(f.value:problem_text::string) != ''
)

select
    -- Primary key components for incremental updates
    comment_id,
    participant_id,
    posted_on,
    problem_sequence,

    -- Source comment details
    reply_to_id,
    content as source_comment,
    question as source_question,
    _file_upload_date,

    -- Extracted problem information
    problem_text,
    length(problem_text) as problem_length,

    -- Department information
    explicit_department,
    inferred_departments_array as inferred_departments,

    -- Combined department list (explicit + inferred, removing duplicates)
    case
        when explicit_department is not null and inferred_departments_array is not null
            then
                array_distinct(array_cat([explicit_department], inferred_departments_array::array))
        when explicit_department is not null
            then
                [explicit_department]
        when inferred_departments_array is not null
            then
                inferred_departments_array::array
    end as all_departments,

    -- AI processing metadata
    problems_json,
    case
        when problems_json is not null then 'SUCCESS'
        else 'FAILED'
    end as extraction_status,

    -- Processing timestamp
    current_timestamp() as processed_at

from flattened_problems
where problem_text is not null
