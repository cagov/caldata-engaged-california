-- noqa: disable=LT05
{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['session_id'],
    on_schema_change='sync_all_columns'
) }}

-- Structured AI analysis of each phase 2 discussion session, flattened to one row per
-- (session, section, theme). Sections: overview, protect_themes, gov_action_themes,
-- general_themes, areas_of_tension, areas_of_consensus, deliberative_moments.
--
-- Flow: render each session's transcript as one text block -> one structured Cortex call
-- per session -> flatten the returned JSON into theme rows -> keep only turn citations
-- that verifiably exist in the session (hallucination guardrail: the LLM cites turns by
-- index and never reproduces quote text, so quotes can be mis-targeted but not invented;
-- unverifiable indices are dropped and themes with none left are removed).
--
-- Sessions too long for a single call (none expected: real sessions are ~12k-106k chars
-- vs the ~500k context limit) take a map-reduce detour: the transcript is cut into
-- contiguous ~400k-char chunks with a small turn overlap, each chunk gets its own theme
-- extraction call (MAP), and the structured summary call synthesizes from those
-- extractions instead of the raw transcript (llm_input_kind = 'map_reduce').
--
-- EVERY session appears in this table: check summary_status. FAILED sessions (LLM call
-- failed, unparseable JSON, or a failed MAP chunk) are retried automatically on the next
-- run, and a warning-severity dbt test flags any non-SUCCESS row so failures are loud.
--
-- Incremental at the SESSION grain: transcripts are immutable once uploaded, so each
-- session is tagged exactly once (LLM cost is only ever incurred for new sessions).
--
-- Methodology validated in notebooks/ai_impact_survey/phase_2_analysis.ipynb.

-- =========================================================================================
-- PROMPTS. Everything between a pair of $$ markers is one plain string literal — edit the
-- prose freely (quotes/apostrophes are safe; just don't type two dollar signs in a row).
--
-- NOTE: this model is incremental, so a prompt edit does NOT re-tag sessions that were
-- already processed. To re-tag everything with new prompts, run:
--   dbt run --full-refresh --select phase2_transcript_session_summaries+
-- =========================================================================================

with prompts as (
    select
        $$You are analyzing transcripts of live small-group discussions held by Engaged California,
an official initiative of California's Government Operations Agency and Office of Data and
Innovation. Engaged California uses deliberative democracy practices to give Californians a
direct voice in state policymaking. The discussion program concerns how AI may impact
Californians' work and lives and what actions government should take in response.
IMPORTANT: Some recordings may be pilot tests, staff work sessions, or interviews that do
not substantively discuss AI policy. Recordings of real discussions may also BEGIN with a
staff setup/logistics segment before participants join — when a substantive participant
discussion is present, base your analysis on that discussion and treat any pre-discussion
staff logistics as incidental context, not as the subject of the session.
Ground every claim in the transcript itself. If the transcript does not contain content
relevant to the question you are asked, say so explicitly and briefly describe what was
actually discussed — NEVER invent themes to fit the question.
The transcript combines transcribed speech and text chat, interleaved chronologically.
Each turn is formatted as: [index] (timestamp, source) speaker: text.
When you reference what someone said, cite the turn index like [turn:42].
NEVER fabricate or reproduce quotes from memory — always refer to turns by their index.
When asked for JSON, respond with JSON only — no prose, no markdown fences.$$
            as system_prompt,

        $$Produce a structured analysis of this discussion. Respond ONLY with a JSON object with keys:
- "overview": 2-3 sentence summary of the session. If the recording contains a substantive
participant discussion, the overview must describe THAT discussion — mention any staff
setup/logistics segment in at most one clause, or not at all
- "protect_themes": each distinct thing participants want to protect regarding AI. Keep
distinct values separate (e.g. ethics/humanity is not the same theme as privacy if
participants treated them separately) and prefer participants' own words for theme labels.
Include themes voiced by only one participant
- "gov_action_themes": EVERY distinct government action or policy proposal participants
made, including narrowly scoped ones (e.g. rules for a specific sector, service, or
setting such as schools). Do not consolidate distinct proposals
- "general_themes": other prominent themes from the participant discussion
- "areas_of_tension": points where participants disagreed
- "areas_of_consensus": points of broad agreement
- "deliberative_moments": moments where a participant changed their view or was persuaded,
a proposal was refined or reworded through group input, a disagreement was resolved, or
participants discovered shared values through clarifying questions
Every key except overview is a list of objects:
{"theme": str, "description": str, "supporting_turn_idxs": [int, ...]}.
supporting_turn_idxs must be actual turn indices from the transcript, and every theme MUST
include at least one supporting turn index.
If a section was not substantively discussed, return an empty list for it — do NOT invent
themes to fill a section.
Do not include speaker names in any text — reference contributions via turn indices only.$$
            as summary_prompt,

        $$From this transcript excerpt, extract the following. Cite representative turns like
[turn:N] throughout, and be concise — this summary feeds a larger synthesis.
1. The prominent themes or perspectives (1-2 sentences each).
2. EVERY concrete policy proposal or suggested government action, however brief or
narrowly scoped — do not consolidate distinct proposals.
3. Values or things participants explicitly name as important to protect — use the
participants' own words as labels and keep distinct values separate.
4. Deliberative moments: disagreement, persuasion, a participant changing their view, or
a proposal being refined/reworded through group input.$$
            as chunk_map_prompt,

        $$You are working from theme extractions of consecutive excerpts of the transcript.
Each cites turns as [turn:N] — use those N values for supporting_turn_idxs.$$
            as map_reduce_instructions
),

-- =========================================================================================
-- Pipeline
-- =========================================================================================

-- Sessions above max_single_call_chars (~the Cortex context limit validated in the
-- notebook) are map-reduced over chunk_target_chars-sized chunks. Chunks can overshoot
-- their target by one turn, hence the margin between the two numbers.
{% set max_single_call_chars = 500000 %}
{% set chunk_target_chars = 400000 %}
{% set chunk_overlap_turns = 4 %}

-- noqa: disable=LT02
-- The JSON schema for Cortex structured outputs must be a single-line string; the jinja
-- set blocks below confuse the linter's indent rule.
{% set theme_array_schema -%}
{"type":"array","items":{"type":"object","properties":{"theme":{"type":"string"},"description":{"type":"string"},"supporting_turn_idxs":{"type":"array","items":{"type":"number"}}},"required":["theme","description","supporting_turn_idxs"]}}
{%- endset %}

{% set response_schema -%}
{"type":"json","schema":{"type":"object","properties":{"overview":{"type":"string"},"protect_themes":{{ theme_array_schema }},"gov_action_themes":{{ theme_array_schema }},"general_themes":{{ theme_array_schema }},"areas_of_tension":{{ theme_array_schema }},"areas_of_consensus":{{ theme_array_schema }},"deliberative_moments":{{ theme_array_schema }}},"required":["overview","protect_themes","gov_action_themes","general_themes","areas_of_tension","areas_of_consensus","deliberative_moments"]}}
{%- endset %}
-- noqa: enable=LT02

turns as (
    select * from {{ ref('phase2_zoom_transcripts_and_chats') }}
),

-- Render each turn in the canonical format the prompts describe:
--   [42] (12:34, chat) Jane D.: I think we need guardrails on...
rendered_turns as (
    select
        session_id,
        turn_idx,
        '[' || turn_idx || '] ('
        || coalesce(
            case
                when start_sec >= 3600
                    then
                        floor(start_sec / 3600)::int
                        || ':' || lpad(floor(mod(start_sec, 3600) / 60)::int, 2, '0')
                        || ':' || lpad(floor(mod(start_sec, 60))::int, 2, '0')
                else
                    lpad(floor(start_sec / 60)::int, 2, '0')
                    || ':' || lpad(floor(mod(start_sec, 60))::int, 2, '0')
            end,
            '??:??'
        )
        || ', ' || source || ') '
        || coalesce(speaker || ': ', '')
        || coalesce(text, '') as turn_line
    from turns
),

transcripts as (
    select
        session_id,
        listagg(turn_line, '\n') within group (order by turn_idx) as transcript_text,
        sum(length(turn_line)) as n_transcript_chars
    from rendered_turns
    group by session_id
),

-- noqa: disable=LT02
-- the `is_incremental()` block is causing issues with the linter. Disabling indentation QA for this CTE only.
sessions_to_process as (
    select *
    from transcripts

    {% if is_incremental() %}
        -- Reprocess anything that isn't SUCCESS yet, so failures retry automatically.
        where session_id not in (
            select t.session_id from {{ this }} as t
            where t.summary_status = 'SUCCESS'
        )
    {% endif %}
),
-- noqa: enable=LT02

-- ------------------------------------------------------------------------------------
-- MAP path, for sessions too long for a single call. Chunk assignment: running character
-- total, integer-divided by the chunk target. A retried session re-runs all of its MAP
-- calls (nothing is memoized between runs).
-- ------------------------------------------------------------------------------------

oversize_turns as (
    select rt.*
    from rendered_turns as rt
    inner join sessions_to_process as s
        on
            rt.session_id = s.session_id
            and s.n_transcript_chars > {{ max_single_call_chars }}
),

cumulative as (
    select
        *,
        coalesce(sum(length(turn_line)) over (
            partition by session_id
            order by turn_idx
            rows between unbounded preceding and 1 preceding
        ), 0) as chars_before
    from oversize_turns
),

assigned as (
    select
        *,
        floor(chars_before / {{ chunk_target_chars }})::int as chunk_no
    from cumulative
),

-- The last few turns of each chunk, replicated into the next chunk so exchanges that
-- straddle a boundary aren't severed.
chunk_tails as (
    select
        *,
        row_number() over (
            partition by session_id, chunk_no
            order by turn_idx desc
        ) as pos_from_chunk_end,
        max(chunk_no) over (partition by session_id) as last_chunk_no
    from assigned
),

with_overlap as (
    select
        session_id,
        chunk_no,
        turn_idx,
        turn_line
    from assigned
    union all
    select
        session_id,
        chunk_no + 1 as chunk_no,
        turn_idx,
        turn_line
    from chunk_tails
    where pos_from_chunk_end <= {{ chunk_overlap_turns }} and chunk_no < last_chunk_no
),

chunks as (
    select
        session_id,
        chunk_no,
        listagg(turn_line, '\n') within group (order by turn_idx) as chunk_text
    from with_overlap
    group by session_id, chunk_no
),

mapped as (
    select
        c.session_id,
        c.chunk_no,
        snowflake.cortex.try_complete(
            '{{ var("llm_model") }}',
            [
                {
                    'role': 'system',
                    'content': p.system_prompt
                },
                {
                    'role': 'user',
                    'content': p.chunk_map_prompt || '\n\nTranscript excerpt:\n' || c.chunk_text
                }
            ],
            object_construct('temperature', 0, 'max_tokens', 4000)
        ) as map_response
    from chunks as c
    cross join prompts as p
),

-- Stitch the chunk extractions into one synthesis input. A session with ANY failed MAP
-- chunk is excluded here (a partial map would silently skew the synthesis) and surfaces
-- below as a FAILED row instead.
reduce_inputs as (
    select
        session_id,
        listagg(
            'Excerpt ' || (chunk_no + 1) || ' summary:\n' || map_response:choices[0]:messages::string,
            '\n\n'
        ) within group (order by chunk_no) as excerpt_text,
        sum(map_response:usage:total_tokens::int) as map_tokens
    from mapped
    group by session_id
    having count_if(map_response:choices[0]:messages is null) = 0
),

-- ------------------------------------------------------------------------------------
-- The structured summary call, fed either the raw transcript or the MAP extractions.
-- ------------------------------------------------------------------------------------

session_inputs as (
    select
        s.session_id,
        s.n_transcript_chars,
        case
            when s.n_transcript_chars <= {{ max_single_call_chars }} then 'whole_transcript'
            else 'map_reduce'
        end as llm_input_kind,
        case
            when s.n_transcript_chars <= {{ max_single_call_chars }}
                then 'Transcript:\n' || s.transcript_text
            else r.excerpt_text
        end as llm_input_text,
        coalesce(r.map_tokens, 0) as map_tokens
    from sessions_to_process as s
    left join reduce_inputs as r
        on s.session_id = r.session_id
),

-- model is determined by the LLM_MODEL environment variable. See docs/llm-cost-control.md
-- TRY_COMPLETE + structured output (response_format): the JSON shape is enforced by Cortex;
-- TRY_COMPLETE returns NULL instead of erroring if the model still produces malformed output.
summarized as (
    select
        i.session_id,
        i.n_transcript_chars,
        i.llm_input_kind,
        i.map_tokens,
        case
            when i.llm_input_text is not null
                then snowflake.cortex.try_complete(
                    '{{ var("llm_model") }}',
                    [
                        {
                            'role': 'system',
                            'content': p.system_prompt
                        },
                        {
                            'role': 'user',
                            'content': p.summary_prompt
                            || case
                                when i.llm_input_kind = 'map_reduce'
                                    then '\n\n' || p.map_reduce_instructions
                                else ''
                            end
                            || '\n\n' || i.llm_input_text
                        }
                    ],
                    object_construct(
                        'temperature', 0,
                        'max_tokens', 8000,
                        'response_format', parse_json('{{ response_schema }}')
                    )
                )
        end as raw_response
    from session_inputs as i
    cross join prompts as p
),

parsed as (
    select
        session_id,
        n_transcript_chars,
        llm_input_kind,
        map_tokens + coalesce(raw_response:usage:total_tokens::int, 0) as llm_total_tokens,
        try_parse_json(to_json(raw_response:structured_output[0]:raw_message)) as summary_json,
        case
            when try_parse_json(to_json(raw_response:structured_output[0]:raw_message)) is null
                then 'FAILED'
            else 'SUCCESS'
        end as summary_status
    from summarized
),

-- One overview row per session, whatever its status
overview_rows as (
    select
        session_id,
        'overview' as section,
        0 as theme_seq,
        null::varchar as theme_label,
        summary_json:overview::string as summary_text,
        [] as supporting_turn_idxs,
        0 as n_supporting_turns,
        0 as n_unverified_idxs_dropped,
        summary_status,
        llm_input_kind,
        n_transcript_chars,
        llm_total_tokens
    from parsed
),

-- One row per (section, theme, cited turn index), straight from the LLM's JSON.
exploded_idxs as (
    select
        p.session_id,
        p.llm_input_kind,
        p.n_transcript_chars,
        p.llm_total_tokens,
        sections.key::string as section,
        items.index + 1 as theme_seq,
        items.value:theme::string as theme_label,
        items.value:description::string as summary_text,
        idx.value::int as raw_turn_idx
    from parsed as p,
        lateral flatten(input => p.summary_json) as sections,
        lateral flatten(input => sections.value) as items,
        lateral flatten(input => items.value:supporting_turn_idxs) as idx
    where p.summary_status = 'SUCCESS' and sections.key != 'overview'
),

-- Hallucination guardrail: keep only turn indices that actually exist in the session.
-- Themes with no verifiable supporting turn (including any the LLM returned with an empty
-- index list) are dropped entirely by the HAVING clause.
theme_rows as (
    select
        e.session_id,
        e.section,
        e.theme_seq,
        e.theme_label,
        e.summary_text,
        array_agg(t.turn_idx) within group (order by t.turn_idx) as supporting_turn_idxs,
        count(t.turn_idx) as n_supporting_turns,
        count(*) - count(t.turn_idx) as n_unverified_idxs_dropped,
        'SUCCESS' as summary_status,
        e.llm_input_kind,
        e.n_transcript_chars,
        e.llm_total_tokens
    from exploded_idxs as e
    left join turns as t
        on
            e.session_id = t.session_id
            and e.raw_turn_idx = t.turn_idx
    group by
        e.session_id,
        e.section,
        e.theme_seq,
        e.theme_label,
        e.summary_text,
        e.llm_input_kind,
        e.n_transcript_chars,
        e.llm_total_tokens
    having count(t.turn_idx) > 0
),

combined as (
    select * from overview_rows
    union all
    select * from theme_rows
)

select
    *,
    '{{ var("llm_model") }}' as llm_model,
    current_timestamp() as processed_at
from combined
