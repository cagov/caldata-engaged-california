-- noqa: disable=LT05
{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['session_id', 'theme_id'],
    on_schema_change='sync_all_columns'
) }}

-- Every non-facilitator turn that substantively expresses one of the manually-curated
-- discussion themes (seeds/zoom/curated_discussion_themes.csv), tagged by AI: one row per
-- (session, theme, tagged turn), with the verbatim turn text, speaker, and timestamps
-- joined back from the source data so dashboards need no joins at read time.
--
-- This differs from phase2_transcript_turn_tags, which explodes the per-session AI-derived
-- themes of phase2_transcript_session_summaries. Here the taxonomy is FIXED and curated by
-- humans across all sessions; the AI only decides which turns express each theme.
--
-- Flow: render each session's transcript as one text block -> ONE structured Cortex call
-- PER (session, theme) asking for the indices of turns in which a participant substantively
-- expresses that theme -> flatten the returned indices -> keep only indices that verifiably
-- exist in the session (hallucination guardrail: the LLM cites turns by index and never
-- reproduces quote text, so tags can be mis-targeted but quotes cannot be invented) -> drop
-- facilitator/staff turns deterministically (display-name heuristic + verified staff roster;
-- the LLM is also instructed to skip them, but the filter here is what's binding).
--
-- EVERY (session, theme) pair appears in this table via a status row (turn_seq = 0): check
-- tag_status. A SUCCESS status row with n_matched_turns = 0 means the call worked and no
-- turns matched; FAILED means the Cortex call returned NULL or unparseable JSON. There is
-- deliberately NO in-query retry (see phase2_transcript_session_summaries for why): FAILED
-- pairs are retried automatically on the next run — only those pairs re-bill — and an
-- error-severity dbt test fails the build so failures are loud, never silent.
--
-- Incremental at the (session, theme) grain: transcripts are immutable once uploaded, so
-- each pair is tagged exactly once. Reserve --full-refresh for changes that invalidate
-- existing rows, all of which this model can NOT detect on its own:
--   * prompt edits in this file;
--   * theme seed edits — a reworded label or description does not re-tag processed pairs
--     (theme_id is manually assigned and stable, so rewording never orphans rows, but the
--     label/description text stored here stays frozen until a --full-refresh);
--   * transcript_times seed changes — re-windowing a session shifts every turn_idx in it,
--     silently mis-pointing this table's existing citations.
--
-- Sessions above ~500k chars (none exist; real sessions are ~12k-200k) are NOT map-reduced
-- here: their calls are skipped entirely and surface as persistent FAILED status rows.
--
-- Run conventions: use `dbt build` (not bare `run`) so the tests gate; a red build is
-- recovered by re-running the same plain build.
--
-- Methodology (index-based citation, guardrails) validated in
-- notebooks/ai_impact_survey/phase_2_analysis.ipynb.
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
NEVER fabricate or reproduce quotes from memory — always refer to turns by their index.
When asked for JSON, respond with JSON only — no prose, no markdown fences.$$
            as system_prompt,

        $$You are checking this transcript for ONE specific theme, defined below. Return the
turn indices of every turn in which a PARTICIPANT substantively expresses, discusses, or
directly engages with this theme in their own contribution.
Do NOT tag: facilitator or staff turns (facilitators pose questions and manage the
session), brief agreements or reactions ("yeah", "agreed", "+1"), or procedural/logistics
talk. A tagged turn must itself substantively convey the theme — do not tag a turn merely
because it is near a relevant exchange.
Respond ONLY with a JSON object of the form: {"matching_turn_idxs": [int, ...]}.
Every index MUST be an actual turn index from the transcript. If no turns substantively
express this theme, return {"matching_turn_idxs": []} — never invent indices, and never
pad the list with tangential matches.$$
            as theme_task_prompt
),

-- The curated taxonomy: this CTE is the fan-out axis (one Cortex call per session per
-- theme). theme_id is the manually-assigned stable grain key from the seed.
themes as (
    select
        theme_id,
        theme_label,
        theme_description
    from {{ ref('stg_curated_discussion_themes') }}
),

-- =========================================================================================
-- Pipeline
-- =========================================================================================

-- Sessions above max_single_call_chars would blow the Cortex context limit; they are
-- skipped (surfacing as FAILED status rows) rather than map-reduced — no such session
-- exists in the phase 2 corpus.
{% set max_single_call_chars = 500000 %}
{% set llm_max_tokens = 4000 %}

-- noqa: disable=LT02
-- The JSON schema for Cortex structured outputs must be a single-line string; the jinja
-- set blocks below confuse the linter's indent rule. additionalProperties:false and
-- required are mandatory on every object: OpenAI-family models (the CI LOW tier) reject
-- the schema without them, returning NULL from every call.
{% set tag_response_schema -%}
{"type":"json","schema":{"type":"object","properties":{"matching_turn_idxs":{"type":"array","items":{"type":"number"}}},"required":["matching_turn_idxs"],"additionalProperties":false}}
{%- endset %}

-- The per-(session, theme) Cortex call. Column references (system_prompt, user_prompt)
-- resolve in the calling CTE's scope.
{% set theme_llm_call -%}
snowflake.cortex.try_complete(
    '{{ var("llm_model") }}',
    [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_prompt}
    ],
    object_construct(
        'temperature', 0,
        'max_tokens', {{ llm_max_tokens }},
        'response_format', parse_json('{{ tag_response_schema }}')
    )
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
        -- A session needs work unless every theme in the CURRENT seed already has a
        -- SUCCESS row for it. The join to `themes` makes this seed-aware: SUCCESS rows for
        -- ids no longer in the seed (removed/renumbered themes) don't count toward the
        -- total, so adding a theme re-opens every session for that id only (the per-pair
        -- filter below narrows the actual calls).
        where session_id not in (
            select t.session_id
            from {{ this }} as t
            inner join themes as th on t.theme_id = th.theme_id
            where t.tag_status = 'SUCCESS'
            group by t.session_id
            having count(distinct t.theme_id) >= (select count(*) from themes)
        )
    {% endif %}
),
-- noqa: enable=LT02

-- noqa: disable=LT02
theme_calls as (
    select
        s.session_id,
        th.theme_id,
        th.theme_label,
        th.theme_description,
        p.system_prompt,
        -- NULL when the session is too big for one call: the CASE short-circuits the
        -- Cortex call below, and the pair lands as a FAILED status row.
        case when s.n_transcript_chars <= {{ max_single_call_chars }}
            then
                p.theme_task_prompt
                || '\n\nTheme: ' || th.theme_label
                || '\nTheme description: ' || th.theme_description
                || '\n\nTranscript:\n' || s.transcript_text
        end as user_prompt
    from sessions_to_process as s
    cross join themes as th
    cross join prompts as p
    {% if is_incremental() %}
        -- Per-pair retry filter: only (session, theme) pairs without a SUCCESS row get
        -- (re)called.
        where not exists (
            select 1 from {{ this }} as t
            where
                t.session_id = s.session_id
                and t.theme_id = th.theme_id
                and t.tag_status = 'SUCCESS'
        )
    {% endif %}
),
-- noqa: enable=LT02

tagged as (
    select
        *,
        case when user_prompt is not null then {{ theme_llm_call }} end as raw_response
    from theme_calls
),

parsed as (
    select
        session_id,
        theme_id,
        theme_label,
        theme_description,
        coalesce(raw_response:usage:total_tokens::int, 0) as llm_tokens,
        try_parse_json(to_json(raw_response:structured_output[0]:raw_message)) as tag_json,
        case
            when try_parse_json(to_json(raw_response:structured_output[0]:raw_message)) is null
                then 'FAILED'
            else 'SUCCESS'
        end as tag_status
    from tagged
),

-- One row per (session, theme, returned index), deduplicated in case the LLM repeats an
-- index.
exploded_idxs as (
    select distinct
        p.session_id,
        p.theme_id,
        idx.value::int as raw_turn_idx
    from parsed as p,
        lateral flatten(input => p.tag_json:matching_turn_idxs) as idx
    where p.tag_status = 'SUCCESS'
),

-- Verified staff/facilitators from the attendance roster. survey_respondent_id = 'staff'
-- alone over-matches (it is also assigned to unmatched attendees upstream), so the join is
-- restricted to rows the roster explicitly marks as staff.
staff_speakers as (
    select distinct
        session_id,
        speaker
    from {{ ref('phase2_speaker_ai_survey') }}
    where survey_respondent_id = 'staff' and attendee_status = 'staff'
),

-- Guardrail 1: an index is kept only if it exists in the session (left-join miss =
-- hallucinated index, dropped and counted).
-- Guardrail 2: facilitator/staff turns are dropped deterministically — display-name
-- heuristic (the same one as phase2_transcript_longest_turns, which also covers chat
-- turns) OR presence on the verified staff roster.
classified as (
    select
        e.session_id,
        e.theme_id,
        t.turn_idx,
        t.source,
        t.src_ref,
        t.start_sec,
        t.end_sec,
        t.speaker,
        t.text,
        (t.turn_idx is null) as is_unverified,
        coalesce(
            t.speaker ilike '%engage%'
            or t.speaker ilike '%facilitator%'
            or t.speaker ilike '%staff%'
            or ss.speaker is not null,
            false
        ) as is_facilitator
    from exploded_idxs as e
    left join turns as t
        on
            e.session_id = t.session_id
            and e.raw_turn_idx = t.turn_idx
    left join staff_speakers as ss
        on
            t.session_id = ss.session_id
            and t.speaker = ss.speaker
),

-- Per-pair audit counts, stamped onto every row of the pair below. Pairs whose call
-- returned an empty index list have no rows here; their status rows coalesce to 0.
pair_counts as (
    select
        session_id,
        theme_id,
        count_if(not is_unverified and not is_facilitator) as n_matched_turns,
        count_if(is_unverified) as n_unverified_idxs_dropped,
        count_if(not is_unverified and is_facilitator) as n_facilitator_turns_dropped
    from classified
    group by session_id, theme_id
),

-- One row per surviving tagged turn, with the verbatim source columns.
turn_rows as (
    select
        p.session_id,
        p.theme_id,
        p.theme_label,
        p.theme_description,
        row_number() over (
            partition by c.session_id, c.theme_id
            order by c.turn_idx
        ) as turn_seq,
        c.turn_idx,
        c.source,
        c.src_ref,
        c.start_sec,
        c.end_sec,
        c.speaker,
        c.text,
        pc.n_matched_turns,
        pc.n_unverified_idxs_dropped,
        pc.n_facilitator_turns_dropped,
        p.tag_status,
        p.llm_tokens
    from classified as c
    inner join parsed as p
        on
            c.session_id = p.session_id
            and c.theme_id = p.theme_id
    inner join pair_counts as pc
        on
            c.session_id = pc.session_id
            and c.theme_id = pc.theme_id
    where not c.is_unverified and not c.is_facilitator
),

-- One status row (turn_seq = 0) per (session, theme) pair, whatever its outcome. This is
-- what distinguishes "call succeeded but no turns matched" from "call failed", and what
-- the incremental filters read to decide which pairs to retry.
status_rows as (
    select
        p.session_id,
        p.theme_id,
        p.theme_label,
        p.theme_description,
        0 as turn_seq,
        null::int as turn_idx,
        null::varchar as source,
        null::int as src_ref,
        null::float as start_sec,
        null::float as end_sec,
        null::varchar as speaker,
        null::varchar as text,
        coalesce(pc.n_matched_turns, 0) as n_matched_turns,
        coalesce(pc.n_unverified_idxs_dropped, 0) as n_unverified_idxs_dropped,
        coalesce(pc.n_facilitator_turns_dropped, 0) as n_facilitator_turns_dropped,
        p.tag_status,
        p.llm_tokens
    from parsed as p
    left join pair_counts as pc
        on
            p.session_id = pc.session_id
            and p.theme_id = pc.theme_id
),

combined as (
    select * from status_rows
    union all
    select * from turn_rows
)

select
    *,
    '{{ var("llm_model") }}' as llm_model,
    current_timestamp() as processed_at
from combined
