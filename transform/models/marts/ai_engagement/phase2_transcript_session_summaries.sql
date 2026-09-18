-- noqa: disable=LT05
{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['session_id', 'section'],
    on_schema_change='sync_all_columns'
) }}

-- Structured AI analysis of each phase 2 discussion session, flattened to one row per
-- (session, section, theme). Sections: overview, protect_themes, gov_action_themes,
-- general_themes, areas_of_tension, areas_of_consensus, deliberative_moments.
--
-- Flow: render each session's transcript as one text block -> ONE structured Cortex call
-- PER (session, section) -> flatten each section's JSON into theme rows -> keep only turn
-- citations that verifiably exist in the session (hallucination guardrail: the LLM cites
-- turns by index and never reproduces quote text, so quotes can be mis-targeted but not
-- invented; unverifiable indices are dropped and themes with none left are removed) ->
-- translate the surviving positional indices into stable turn_hashes for storage.
--
-- WHY turn_hashes: turn_idx is positional, so it renumbers whenever an upstream filter or
-- parsing rule changes the set of turns. Summaries therefore store the content-addressed
-- turn_hash of each supporting turn, and every row is stamped with a fingerprint of the
-- session's turn_hashes as of tagging. A session is (re)tagged whenever its current
-- fingerprint differs — i.e. whenever any turn was added, removed, regrouped, or edited.
--
-- WHY per-section calls: Cortex COMPLETE calls fail transiently in proportion to how long
-- they run, and call duration is dominated by output length. A whole-session call writes
-- ~7k tokens of JSON over 60-90s and failed ~37% of the time (opus, 2026-07-29); a
-- single-section call writes a fraction of that and finishes far below the timeout zone.
-- The trade-off is input cost: every section call re-reads the transcript (Cortex has no
-- prompt caching), so a session costs ~7x the input tokens of the old single-call design.
-- There is deliberately NO in-query retry: a failed call surfaces as a FAILED status row
-- and is retried on the next run instead. In-query retries only mask transient failures
-- (rare at this call size) but multiply the runtime and cost of systematic ones — a
-- misconfigured model would fail every call N times inside one multi-hour statement.
--
-- Sessions too long for a single call (none expected: real sessions are ~12k-200k chars
-- vs the ~500k context limit) take a map-reduce detour: the transcript is cut into
-- contiguous ~400k-char chunks with a small turn overlap, each chunk gets its own theme
-- extraction call (MAP), and the section calls synthesize from those extractions instead
-- of the raw transcript (llm_input_kind = 'map_reduce').
--
-- EVERY (session, section) pair appears in this table via a status row (theme_seq = 0):
-- check summary_status. FAILED pairs (LLM call returned NULL, or unparseable JSON)
-- are retried automatically on the next run — only the failed sections re-bill — and an
-- error-severity dbt test fails the run so failures are loud, never silent.
--
-- Run conventions: use `dbt build` (not bare `run`) so the tests actually gate; a red
-- build is recovered by re-running the same plain build; reserve --full-refresh for
-- prompt/logic changes — it re-bills every session. (Upstream transcript changes do NOT
-- need one: the fingerprint check below re-tags affected sessions automatically.)
--
-- Incremental at the (session, section) grain. A (session, section) is called when this
-- table has no SUCCESS row for it built from the session's CURRENT transcript fingerprint:
-- new sessions, failed sections, and every section of a session whose turns changed since
-- it was tagged (which re-bills that whole session).
--
-- Methodology validated in notebooks/ai_impact_survey/phase_2_analysis.ipynb.

-- =========================================================================================
-- PROMPTS. Everything between a pair of $$ markers is one plain string literal — edit the
-- prose freely (quotes/apostrophes are safe; just don't type two dollar signs in a row).
--
-- NOTE: this model is incremental, so a prompt edit does NOT re-tag sessions that were
-- already processed. To re-tag everything with new prompts, run:
--   dbt build --full-refresh --select phase2_transcript_session_summaries+
-- =========================================================================================

with prompts as (
    select
        $$You are analyzing transcripts of live small-group discussions held by Engaged California,
an official initiative of California's Government Operations Agency and Office of Data and
Innovation. Engaged California uses deliberative democracy practices to give Californians a
direct voice in state policymaking. The discussion program concerns how AI may impact
Californians' work and lives and what actions government should take in response.
Ground every claim in the transcript itself. If the transcript does not contain content
relevant to the question you are asked, say so explicitly and briefly describe what was
actually discussed — NEVER invent themes to fit the question.
The transcript combines transcribed speech and text chat, interleaved chronologically.
Each turn is formatted as: [index] (timestamp, source) speaker: text.
When you reference what someone said, cite the turn index like [turn:42].
NEVER fabricate or reproduce quotes from memory — always refer to turns by their index.
When asked for JSON, respond with JSON only — no prose, no markdown fences.$$
            as system_prompt,

        -- Appended to every theme-section prompt below (not the overview).
        $$Respond ONLY with a JSON object of the form:
{"themes": [{"theme": str, "description": str, "supporting_turn_idxs": [int, ...]}]}.
Prefer participants' own words for theme labels. supporting_turn_idxs must be actual turn
indices from the transcript, and every theme MUST include at least one supporting turn index.
If this aspect was not substantively discussed in the session, return an empty list — do
NOT invent themes to fill it.
Do not include speaker names in any text — reference contributions via turn indices only.$$
            as theme_output_rules,

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

-- One row per summary section; each section is its own Cortex call. If you add or remove
-- a section here, update the accepted_values test in _ai_engagement_mart_models.yml (a new
-- section is simply pending for every session on the next run).
sections as (
    select
        'overview' as section,
        $$Write a 2-3 sentence summary of the session. If the recording contains a substantive
participant discussion, the summary must describe THAT discussion.
Respond ONLY with a JSON object of the form: {"overview": str}.
Do not include speaker names — reference contributions via turn indices only.$$
            as section_prompt
    union all
    select
        'protect_themes',
        $$Identify each distinct thing participants want to PROTECT with regard to AI. Keep
distinct values separate (e.g. ethics/humanity is not the same theme as privacy if
participants treated them separately). Include themes voiced by only one participant.$$
    union all
    select
        'gov_action_themes',
        $$Identify EVERY distinct government action or policy proposal participants made,
including narrowly scoped ones (e.g. rules for a specific sector, service, or setting
such as schools). Do not consolidate distinct proposals into one theme.$$
    union all
    select
        'general_themes',
        $$Identify the other prominent themes of the participant discussion — themes that are
not primarily something participants want protected and not a specific proposed
government action (those are captured separately).$$
    union all
    select
        'areas_of_tension',
        $$Identify the points where participants disagreed with each other.$$
    union all
    select
        'areas_of_consensus',
        $$Identify the points of broad agreement among participants.$$
    union all
    select
        'deliberative_moments',
        $$Identify the deliberative moments of the discussion: a participant changed their view
or was persuaded, a proposal was refined or reworded through group input, a disagreement
was resolved, or participants discovered shared values through clarifying questions.$$
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
{% set llm_max_tokens = 16000 %}

-- noqa: disable=LT02
-- The JSON schema for Cortex structured outputs must be a single-line string; the jinja
-- set blocks below confuse the linter's indent rule.
{% set theme_array_schema -%}
{"type":"array","items":{"type":"object","properties":{"theme":{"type":"string"},"description":{"type":"string"},"supporting_turn_idxs":{"type":"array","items":{"type":"number"}}},"required":["theme","description","supporting_turn_idxs"],"additionalProperties":false}}
{%- endset %}

{% set themes_response_schema -%}
{"type":"json","schema":{"type":"object","properties":{"themes":{{ theme_array_schema }}},"required":["themes"],"additionalProperties":false}}
{%- endset %}

{% set overview_response_schema -%}
{"type":"json","schema":{"type":"object","properties":{"overview":{"type":"string"}},"required":["overview"],"additionalProperties":false}}
{%- endset %}

-- The per-section Cortex call. Column references (system_prompt, user_prompt,
-- response_schema) resolve in the calling CTE's scope.
{% set section_llm_call -%}
snowflake.cortex.try_complete(
    '{{ var("llm_model") }}',
    [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_prompt}
    ],
    object_construct(
        'temperature', 0,
        'max_tokens', {{ llm_max_tokens }},
        'response_format', parse_json(response_schema)
    )
)
{%- endset %}

{% set map_llm_call -%}
snowflake.cortex.try_complete(
    '{{ var("llm_model") }}',
    [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': chunk_map_prompt || '\n\nTranscript excerpt:\n' || chunk_text}
    ],
    object_construct('temperature', 0, 'max_tokens', 4000)
)
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
        turn_hash,
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
        sum(length(turn_line)) as n_transcript_chars,
        -- Order-independent hash of the session's turn_hashes: changes iff the set of turns
        -- (or any turn's content) changes. Stamped on every row this session produces.
        hash_agg(turn_hash) as transcript_fingerprint
    from rendered_turns
    group by session_id
),

-- noqa: disable=LT02
-- the `is_incremental()` block is causing issues with the linter. Disabling indentation QA for this CTE only.
-- Which (session, section) calls to make: a pair is pending unless this table already holds
-- a SUCCESS row for it built from the session's current transcript fingerprint. That covers
-- new sessions, failed-section retries, and full re-tags of sessions whose turns changed.
pending_sections as (
    select
        t.session_id,
        s.section
    from transcripts as t
    cross join sections as s
    {% if is_incremental() %}
        {#- Migration guard: a table built before transcript_fingerprint existed has no way to
            prove any row is current, so everything is pending and the plain build re-tags it
            all (no --full-refresh needed). Harmless once every environment carries the column. -#}
        {%- set existing_cols = adapter.get_columns_in_relation(this) | map(attribute='name') | map('upper') | list -%}
        {% if 'TRANSCRIPT_FINGERPRINT' in existing_cols %}
        where not exists (
            select 1 from {{ this }} as done
            where
                done.session_id = t.session_id
                and done.section = s.section
                and done.summary_status = 'SUCCESS'
                and done.transcript_fingerprint = t.transcript_fingerprint
        )
        {% endif %}
    {% endif %}
),
-- noqa: enable=LT02

sessions_to_process as (
    select t.*
    from transcripts as t
    where t.session_id in (select ps.session_id from pending_sections as ps)
),

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
        c.session_id,
        c.chunk_no,
        p.system_prompt,
        p.chunk_map_prompt,
        listagg(c.turn_line, '\n') within group (order by c.turn_idx) as chunk_text
    from with_overlap as c
    cross join prompts as p
    group by c.session_id, c.chunk_no, p.system_prompt, p.chunk_map_prompt
),

-- A failed MAP call (NULL response) is not retried in-query: it fails the session's
-- sections below, and the next run re-runs the whole map pass for that session.
mapped as (
    select
        session_id,
        chunk_no,
        {{ map_llm_call }} as map_response
    from chunks
),

-- Stitch the chunk extractions into one synthesis input. A session with ANY failed MAP
-- chunk is excluded here (a partial map would silently skew the synthesis) and surfaces
-- below as FAILED section rows instead.
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

session_inputs as (
    select
        s.session_id,
        s.n_transcript_chars,
        s.transcript_fingerprint,
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

-- ------------------------------------------------------------------------------------
-- One structured Cortex call per (session, section), fed either the raw transcript or
-- the MAP extractions. The model is determined by the LLM_MODEL environment variable —
-- see docs/llm-cost-control.md.
-- TRY_COMPLETE + structured output (response_format): the JSON shape is enforced by
-- Cortex; TRY_COMPLETE returns NULL instead of erroring when a call fails, and a NULL
-- becomes a FAILED status row that the next run retries.
-- ------------------------------------------------------------------------------------

-- noqa: disable=LT02
section_calls as (
    select
        i.session_id,
        i.n_transcript_chars,
        i.transcript_fingerprint,
        i.llm_input_kind,
        i.map_tokens,
        s.section,
        p.system_prompt,
        case when i.llm_input_text is not null
            then
                s.section_prompt
                || case when s.section != 'overview' then '\n' || p.theme_output_rules else '' end
                || case when i.llm_input_kind = 'map_reduce' then '\n\n' || p.map_reduce_instructions else '' end
                || '\n\n' || i.llm_input_text
        end as user_prompt,
        case when s.section = 'overview'
            then '{{ overview_response_schema }}'
            else '{{ themes_response_schema }}'
        end as response_schema
    from session_inputs as i
    inner join pending_sections as ps
        on i.session_id = ps.session_id
    inner join sections as s
        on ps.section = s.section
    cross join prompts as p
),
-- noqa: enable=LT02

summarized as (
    select
        *,
        case when user_prompt is not null then {{ section_llm_call }} end as raw_response
    from section_calls
),

parsed as (
    select
        session_id,
        section,
        n_transcript_chars,
        transcript_fingerprint,
        llm_input_kind,
        map_tokens,
        coalesce(raw_response:usage:total_tokens::int, 0) as section_tokens,
        try_parse_json(to_json(raw_response:structured_output[0]:raw_message)) as section_json,
        case
            when try_parse_json(to_json(raw_response:structured_output[0]:raw_message)) is null
                then 'FAILED'
            else 'SUCCESS'
        end as summary_status
    from summarized
),

-- Session-level token total (all section calls + any MAP calls), stamped on every row of
-- the session for dashboard compatibility. map_tokens is constant per session, so it is
-- added once rather than summed across rows.
with_session_tokens as (
    select
        *,
        map_tokens + sum(section_tokens) over (partition by session_id) as llm_total_tokens
    from parsed
),

-- One overview row per session, whatever its status.
overview_rows as (
    select
        session_id,
        section,
        0 as theme_seq,
        null::varchar as theme_label,
        section_json:overview::string as summary_text,
        [] as supporting_turn_hashes,
        0 as n_supporting_turns,
        0 as n_unverified_idxs_dropped,
        summary_status,
        llm_input_kind,
        n_transcript_chars,
        transcript_fingerprint,
        llm_total_tokens
    from with_session_tokens
    where section = 'overview'
),

-- One status row (theme_seq = 0) per (session, theme section), whatever its status. This
-- is what distinguishes "section succeeded but found no themes" from "section call
-- failed", and what the incremental filter reads to decide which sections to retry.
section_status_rows as (
    select
        session_id,
        section,
        0 as theme_seq,
        null::varchar as theme_label,
        null::varchar as summary_text,
        [] as supporting_turn_hashes,
        0 as n_supporting_turns,
        0 as n_unverified_idxs_dropped,
        summary_status,
        llm_input_kind,
        n_transcript_chars,
        transcript_fingerprint,
        llm_total_tokens
    from with_session_tokens
    where section != 'overview'
),

-- One row per (section, theme, cited turn index), straight from the LLM's JSON.
exploded_idxs as (
    select
        p.session_id,
        p.section,
        p.llm_input_kind,
        p.n_transcript_chars,
        p.transcript_fingerprint,
        p.llm_total_tokens,
        items.index + 1 as theme_seq,
        items.value:theme::string as theme_label,
        items.value:description::string as summary_text,
        idx.value::int as raw_turn_idx
    from with_session_tokens as p,
        lateral flatten(input => p.section_json:themes) as items,
        lateral flatten(input => items.value:supporting_turn_idxs) as idx
    where p.summary_status = 'SUCCESS' and p.section != 'overview'
),

-- Hallucination guardrail: keep only turn indices that actually exist in the session, and
-- store them as stable turn_hashes rather than positional indices. Themes with no verifiable
-- supporting turn (including any the LLM returned with an empty index list) are dropped
-- entirely by the HAVING clause.
theme_rows as (
    select
        e.session_id,
        e.section,
        e.theme_seq,
        e.theme_label,
        e.summary_text,
        array_agg(t.turn_hash) within group (order by t.turn_idx) as supporting_turn_hashes,
        count(t.turn_idx) as n_supporting_turns,
        count(*) - count(t.turn_idx) as n_unverified_idxs_dropped,
        'SUCCESS' as summary_status,
        e.llm_input_kind,
        e.n_transcript_chars,
        e.transcript_fingerprint,
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
        e.transcript_fingerprint,
        e.llm_total_tokens
    having count(t.turn_idx) > 0
),

combined as (
    select * from overview_rows
    union all
    select * from section_status_rows
    union all
    select * from theme_rows
)

select
    *,
    '{{ var("llm_model") }}' as llm_model,
    current_timestamp() as processed_at
from combined
