-- noqa: disable=LT05
{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['comment_id'],
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
                c.posted_on > (select max(t.posted_on) from {{ this }} as t)
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

        -- Extract problems using Snowflake Cortex AI with fallback handling
        -- model is determined by which environment you are in (i.e. dev or prd). See LLM_COST_CONTOL.md
        -- TRY_COMPLETE returns response metadata; actual JSON is nested at structured_output[0].raw_message
        -- Using TRY_COMPLETE instead of AI_COMPLETE for NULL-on-failure vs hard error on malformed JSON
        -- We use TRY_COMPLETE because with the structured output, the smaller models we use in dev are more likely to have issues. See snowflake documentation for details.
        coalesce(
            try_parse_json(
                to_json(
                    SNOWFLAKE.CORTEX.TRY_COMPLETE(
                        '{{ var("llm_model") }}',
                        [
                            {
                                'role': 'user',
                                'content': concat(
                            'You are analyzing comments from California state employees about government efficiency. ',
                            'Extract the PRIMARY problems described in this comment as concise summaries that preserve key details.\n\n',
                            'Extract ONLY the problems, issues, and inefficiencies. Ignore proposed solutions.\n\n',

                            'COMMENT CONTEXT:\n',
                            'Question/Prompt: ', coalesce(sc.question, '[No context]'), '\n',
                            'Comment Content: ', sc.content, '\n',
                            case
                                when sc.explicit_department is not null
                                    then concat('Department/Agency: ', sc.explicit_department, '\n')
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
                            '• Focus on substantial, actionable problems\n',
                            '• If a comment does not contain a problem, return {"problems": []}\n\n',

                            'JSON OUTPUT REQUIREMENTS:\n',
                            '• Use only standard alphanumeric characters, spaces, and basic punctuation\n',
                            '• Avoid special characters like backticks, curly quotes, or extended Unicode\n',
                            '• Escape quotes properly with backslashes\n',

                            case
                                when sc.explicit_department is null
                                    then 'DEPARTMENT INFERENCE:\n'
                                        || '• Extract relevant California state departments based on the comment content\n'
                                        || '• Consider the following departments (including when their full name is mentioned): DGS, CalHR, SCO, Controller, CalFire, CDCR, GovOps, CNRA, CDPH, DSH, CDT, CDA, CDTFA, ODI, SPB, HCAI, DMHC, CDSS, DHCS, DDS, CCC, CEC, DWR, SCC, DOC, FTB, OAL, DMV, EDD, DOF, CALTRANS, ARB, CDPR, CAL FIRE, CDFW, HCD, CDE, DIR, DCA, CalPERS, BOE, CPUC, Cal OES, EMSA, DTSC, CalVet, CHHS, CalHHS, BCSH, LWDA, FI$Cal, CDFA, etc.\n\n'
                                else ''
                            end,

                            'EXAMPLES OF COMPREHENSIVE EXTRACTION:\n',
                            'Input: "We are very poorly trained and lack operational consistency. Every office is doing something different, every agency does the same process different ways, there needs to be a smoother process on how we do things in each agency. There are too many hands in the pot, just to get something approved as simple as office supplies, it has a minimum of 5 people processing an order, we are spending more money in labor then what the supply request cost. There should be statewide system for things like procurement, timesheets, basically any common function that is takes to run an agency."\n',

                            'Expected: "Lack of statewide standardized systems for common functions like procurement and timesheets results in every office and agency operating differently, with excessive approval workflows for simple administrative tasks"\n\n',
                            'Input: "The procurement process is overly complicated, time consuming, and often not the most cost efficient. For example, we are required to purchase chairs from CalPIA. CalPIA charges $500+ for one desk chair and then another $30 per chair to deliver. The same chair could be purchased from another retailer for a fraction of the price. In addition, the ordering time is outrageous. Purchases go through many levels of approval before getting to the vendor and many times the required vendor turn around time is 60+ business days. Small businesses and disabled veteran-owned businesses get preference, and many times, these small businesses order from retailers like Amazon and then upcharge the State. There is nothing cost efficient about the procurement process. We should be able to buy small things ourselves without going through CalPIA."\n',
                            'Expected: "Mandatory procurement through CalPIA and preferred small/disabled veteran-owned businesses results in significantly higher costs with additional delivery fees and vendor markups that waste taxpayer funds"\n\n',

                            'Return exactly 1 consolidated problem per comment unless the source comment contains multiple, truly unrelated problems.\n\n',
                            'IMPORTANT LENGTH LIMIT: Ensure the **entire** JSON response (including the JSON structure itself) is less than 500 tokens'
                        )
                    }
                ],
                object_construct(
                    'temperature', 0.00,
                    'max_tokens', 8000,
                    'top_p', 0.0,
                    'response_format', parse_json('{"type":"json","schema":{"type":"object","properties":{"problems":{"type":"array","items":{"type":"object","properties":{"problem_text":{"type":"string"},"inferred_departments":{"type":"array","items":{"type":"string"}}},"required":["problem_text"]}}},"required":["problems"]}}')
                )
            ):structured_output[0]:raw_message
                )
            ),
        -- Fallback: return empty problems array if JSON parsing fails
        parse_json('{"problems": []}')
    ) as problems_json
    from source_comments as sc
),

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
            partition by pe.comment_id
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
