-- noqa: disable=LT05
{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['solution_id'],
    on_schema_change='sync_all_columns'
) }}

-- noqa: disable=LT02
-- the `is_incremental()` block is causing issues with the linter. Disabling indentation QA for this CTE only.

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
        and sc.comment_id is not null -- removes any rows with null comment_ids including any "What makes you proud...?" rows

        {% if is_incremental() %}
            -- Only process new records since last run
            and (
                sc.posted_on > (select max(t.posted_on) from {{ this }} as t)
            )
        {% endif %}

    order by sc.posted_on desc
),

-- noqa: enable=LT02

-- In order to provide better context for replies, this CTE builds out the full parent comment thread for each reply.
-- The second half of the CTE is removed because the replies are currently removed in later processing.
-- This was kept to allow for future flexibility.
-- This CTE is RECURSIVE.
comment_threads as (

    select
        c.comment_id,
        c.reply_to_id,
        c.participant_id,
        c.content,
        c.question,
        c.posted_on,
        c._file_upload_date,
        '' as conversation_context,
        null as parent_comment_id,
        0 as depth,
        c.comment_id as sort_path
    from source_comments as c
    where c.reply_to_id is null

    -- UNION ALL

    -- select
    --     c.comment_id,
    --     c.reply_to_id,
    --     c.participant_id,
    --     c.content,
    --     c.question,
    --     c.posted_on,
    --     c._file_upload_date,
    --     case
    --         when p.conversation_context = ''
    --             then 'original: ' || p.content
    --         else p.conversation_context || '\n' || repeat('    ',p.depth) || 'reply: ' || p.content
    --     end as conversation_context,
    --     p.comment_id as parent_comment_id,
    --     p.depth + 1 as depth,
    --     p.sort_path || '.' || c.comment_id as sort_path
    -- from source_comments c
    -- join comment_threads p
    --     on c.reply_to_id = p.comment_id
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

        -- Extract solutions using Snowflake Cortex AI with fallback handling.
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
                                    'Extract the PRIMARY solutions described in this comment as concise summaries that preserve key details.\n\n',
                                    'Extract ONLY the solutions, recommendations, and proposed improvements. Ignore problem descriptions.\n\n',

                                    'COMMENT CONTEXT:\n',
                                    'Question/Prompt: ', coalesce(ct.question, '[No context]'), '\n',
                                    case
                                        when ct.conversation_context != ''
                                            then concat('Conversation context (the comment is a reply): ', ct.conversation_context, '\n')
                                        else ''
                                    end,
                                    'Comment Content: ', ct.content, '\n',
                                    '\n',

                                    'GUIDELINES PART 1:\n',
                                    '• Identify main solutions and recommendations, not minor suggestions\n',
                                    '• Preserve specific program names, systems, and technologies mentioned\n',
                                    '• CONSOLIDATE complementary steps in one implementation; SEPARATE independent recommendations requiring different decision-makers\n',
                                    '• One solution = one actionable recommendation for leadership\n',
                                    '• Focus on substantial, actionable solutions\n',
                                    '• If a comment does not contain a solution, return {"solutions": []}\n\n',

                                    'GUIDELINES PART 2:\n',
                                    '• Summarize comprehensively but as concisely as possible\n',
                                    '• Write at an 8th grade reading level or lower\n',
                                    '• Use smaller, more common words\n',
                                    '• Avoid jargon and technical terms as much as possible\n',
                                    '• Keep sentences short and simple\n',

                                    'JSON OUTPUT REQUIREMENTS:\n',
                                    '• Use only standard alphanumeric characters, spaces, and basic punctuation\n',
                                    '• Avoid special characters like backticks, curly quotes, or extended Unicode\n',
                                    '• Escape quotes properly with backslashes\n',

                                    'EXAMPLES OF COMPREHENSIVE EXTRACTION:\n',
                                    'Input: "There needs to be a better process for getting duplicate pay warrants issued. I often have employees waiting a month or more just to receive a replacement warrant. This delay is really frustrating for employees who need their pay and creates extra work for managers who have to field complaints. I like Cal Employee Connect but I think they could add functionality to it, giving the employee the ability to request their own duplicate warrant directly with the SCO."\n',
                                    'Output: "Reduce processing time for replacement paychecks. Allow staff to ask for a replacement pay warrant through Cal Employee Connect."\n\n',

                                    'Input: "CDCR Fire needs a complete reorganization. Currently, multiple fire stations operate independently, answering to Plant Operations or Wardens. Each station procures its own PPE, hoses, tools, and follows local policies—resulting in a fragmented system with no standardization or unified effectiveness. A centralized command starting in Sacramento is essential. Appointing a Fire Chief and Deputy Chief, supported by three Division Chiefs (North, Central, South), would create statewide oversight. Each fire station would have a Battalion Chief supervising Fire Captains, ensuring consistency and accountability."\n',
                                    'Output: "Make the California Department of Corrections and Rehabilitation (CDCR) fire command more consistent and accountable. Create a centralized command station with regional division chiefs."\n\n',

                                    'Input: "I think it is important that we see the human through the process and not get locked into legalities. If the human is seen and their needs are met the ability to serve their customer is shifted."\n',
                                    'Output: Improve customer service. Encourage staff to see residents’ humanity instead of the red tape."\n\n',

                                    'Input: "I have developed checklists and job aids on my own to assist in successful operations because our centralized services units refuse to go on the record with current instructions or procedures. My team is continually refining our products and documentation to remain relevant and effective. I try to be proactive in my client interactions, holding empathy for those unfamiliar with our services. Under-performing staff are not effectively coached nor held accountable for under-performance. Managers and executives say they hold lofty values but in practice regularly exclude input from below and/or get defensive about calls for change. [For example,] Survey results and reports are delivered to the executive level and then fall into a black hole, never to be heard from again."\n',
                                    'Output (multiple):"\n',
                                    'Update instructions and procedures. Create job aids and share with all staff.\n',
                                    'Improve staff performance. Coach under-performing staff and hold them accountable.\n',
                                    'Include staff voices. Use staff input for change, not only to inform leadership."\n\n',

                                    'Remember: one solution = one actionable recommendation for leadership. Return exactly 1 consolidated solution per comment unless the source comment contains multiple, truly unique solutions.',
                                    'IMPORTANT LENGTH LIMIT: Ensure the **entire** JSON response (including the JSON structure itself) is less than 500 tokens'
                                )
                            }
                        ],
                        object_construct(
                            'temperature', 0.00,
                            'max_tokens', 8000,
                            'top_p', 0.0,
                            'response_format', parse_json('{"type":"json","schema":{"type":"object","properties":{"solutions":{"type":"array","items":{"type":"string"}}},"required":["solutions"]}}')
                        )
                    ):structured_output[0]:raw_message
                )
            )::OBJECT,
            -- Fallback: empty array object
            parse_json('{"solutions": []}')::OBJECT
        ) as solutions_json
    from comment_threads as ct
    where
        -- Only process comments that are not replies (original comments only)
        ct.reply_to_id is null
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
        f.value::STRING as solution_text

    from solution_extraction as se,
        lateral flatten(input => solutions_array, outer => true) as f
    where f.value is not null and trim(f.value::STRING) != ''
),


-- Use AI to extract shorter solutions from each solution statement
-- solution_exctraction CTE uses long lines of text that exceed line length limits.
-- Disabling line length QA for these CTEs only.
-- noqa: disable=L016
solution_shortened as (
    select
        fs.*,
        -- Extract solutions using Snowflake Cortex AI with fallback handling.
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
                                    'You are analyzing proposed solutions from California state employees about making the government more efficient. ',
                                    'Shorten each statement to 5-8 words by removing any details about the problem it solves, and summarizing the gist of the solution.\n\n',
                                    'Extract ONLY the general action items, proposed solutions, or recommendations. Ignore problem descriptions, for statements that explain what the solution solves, and department names or acronyms.\n\n',

                                    'COMMENT CONTEXT:\n',
                                    'Comment Content: ', fs.solution_text, '\n',

                                    'GUIDELINES:\n',
                                    '• Identify main solutions and recommendations, not minor suggestions\n',
                                    '• One solution = one actionable recommendation for leadership\n',
                                    '• Summarize as concisely as possible\n',
                                    '• Focus on substantial, actionable solutions\n',

                                    'JSON OUTPUT REQUIREMENTS:\n',
                                    '• Use only standard alphanumeric characters, spaces, and basic punctuation\n',
                                    '• Avoid special characters like backticks, curly quotes, or extended Unicode\n',
                                    '• Escape quotes properly with backslashes\n',

                                    'EXAMPLES OF COMPREHENSIVE EXTRACTION:\n',
                                    'Input: "Implement contract penalty provisions charging contractors for delays and cost overruns while requiring contractors to absorb additional costs beyond original bid amounts rather than passing them to the state"\n',
                                    'Output: "Implement contract penalties for delays and cost overruns."\n\n',

                                    'Input: "Continue and expand telework programs for state employees to increase efficiency through reduced commuting time, lower overhead costs for office space and utilities, and improved public service responsiveness using secure cloud systems, videoconferencing, and shared databases."\n',
                                    'Output: "Continue and expand telework for state employees"\n\n',

                                    'Input: "Standardize software and tools across all state departments for personnel and HR information, web site content, and project management (SharePoint) similar to the FisCAL effort"\n',
                                    'Output: "Standardize HR software and tools across all departments"\n\n',

                                    'Remember: one solution = one short, actionable recommendation for leadership. Return exactly 1 consolidated solution per comment unless the source comment contains multiple, truly unique solutions.',
                                    'IMPORTANT LENGTH LIMIT: Ensure the **entire** JSON response (including the JSON structure itself) is less than 500 tokens'
                                )
                            }
                        ],
                        object_construct(
                            'temperature', 0.00,
                            'max_tokens', 8000,
                            'top_p', 0.0,
                            'response_format',
                            parse_json(
                                '{"type":"json","schema":{"type":"object","properties":{"solutions":{"type":"array","items":{"type":"string"}}},"required":["solutions"]}}'
                            )
                        )
                    ):structured_output[0]:raw_message
                )
            )::OBJECT,
            -- Fallback: empty array object
            parse_json('{"solutions": []}')::OBJECT
        ) as solution_shortened_json,

        case
            when solution_shortened_json:solutions is not null then solution_shortened_json:solutions
            else []
        end as solution_shortened_array,

        -- Concatenate shortened_solutions into a single string to ensure one row per solution:
        array_to_string(transform(solution_shortened_json:solutions, x -> x::STRING), ' | ') as solution_shortened_all

    from flattened_solutions as fs
)
-- noqa: enable=L016

select
    -- Primary key components for incremental updates
    comment_id,
    participant_id,
    posted_on,
    solution_sequence,

    --solution_id
    row_number() over (
        order by comment_id, solution_sequence
    ) as solution_id,

    -- Source comment details
    reply_to_id,
    parent_comment_id,
    content as source_comment,
    question as source_question,

    -- Extracted solution information
    solution_text,
    length(solution_text) as solution_length,
    solutions_json,
    solution_shortened_all,
    solution_shortened_array,
    solution_shortened_json,

    -- Timestamps
    _file_upload_date,
    current_timestamp() as processed_at

from solution_shortened
where solution_text is not null
