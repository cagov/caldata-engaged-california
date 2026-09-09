-- noqa: disable=LT05
{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['session_id', 'policy_concept_id'],
    on_schema_change='sync_all_columns'
) }}

-- Stage-2 standalone review of the tags in phase2_transcript_curated_theme_tags: one
-- verdict row per tagged turn saying whether it works as a STANDALONE pull quote, plus one
-- status row (null turn_hash) per (session, policy concept) pair.
--
-- Why a second stage: the tagging call reads the full transcript, so turns that are
-- relevant only via surrounding context ("Exactly.", trailing fragments, rambling
-- multi-topic turns cross-tagged everywhere) look relevant to it. This reviewer sees each
-- candidate quote EXACTLY as a report reader would — the text alone, no transcript — so a
-- context-dependent quote structurally cannot pass. The reviewer is monotone: it can only
-- reject stage-1 tags, never add turns, so the hallucination guardrails of stage 1 remain
-- binding. Validated empirically 2026-09-08 on sessions 14 + 1 (339 tag rows): ~48% of
-- tags rejected, 75% agreement with an independent tightened-prompt re-tagging run, with
-- rejections dominated by self-introductions and long multi-topic turns. Stage 1 stays
-- deliberately recall-oriented; precision lives here.
--
-- Flow: per (session, policy concept) pair with at least one tagged turn, ONE structured
-- Cortex call listing the pair's quotes as `[turn_idx] text` -> flatten the returned
-- keep indices -> a candidate's keep flag is whether its index was returned (indices the
-- model returns that were never candidates are ignored and counted in n_invented_idxs).
-- FAILED calls (NULL or unparseable JSON) yield only a FAILED status row — no verdict
-- rows — and are retried on the next run; an error-severity test keeps failures loud.
-- There is deliberately NO in-query retry (see phase2_transcript_session_summaries).
--
-- Incremental at the (session, policy concept) grain. A pair is re-reviewed when it has no
-- SUCCESS row at its CURRENT pair_tag_fingerprint (HASH_AGG of the pair's tagged
-- turn_hashes) — so stage-1 re-tags and upstream transcript changes re-review exactly the
-- affected pairs, and unchanged pairs never re-bill. Reserve --full-refresh for edits to
-- the review prompt in this file.
--
-- The dashboard hard-excludes quote rows without keep = true (fail-closed: unreviewed or
-- FAILED pairs are hidden until this model's next successful run).
-- =========================================================================================

{% set llm_max_tokens = 4000 %}

with prompts as (
    select
        $$You are reviewing candidate pull quotes for a public report on Engaged California
deliberative discussion sessions about how AI may impact Californians' work and lives.
When asked for JSON, respond with JSON only — no prose, no markdown fences.$$
            as system_prompt,

        $$Below are candidate pull quotes that were tagged as expressing one specific policy
concept. You see each candidate EXACTLY as a report reader would: the quote text alone,
with no surrounding conversation.
KEEP a candidate only if BOTH hold:
1. Standing alone, it substantively expresses, discusses, or directly engages with the
   policy concept below.
2. It is a self-contained, comprehensible statement — a reader must be able to understand
   the speaker's point from this text alone.
DROP candidates that are agreements or reactions ("exactly", "I agree", "love this"),
sentence fragments or trailing clauses, procedural talk, or anything whose meaning
depends on context you cannot see.$$
            as review_task_prompt
),

tag_quotes as (
    select
        session_id,
        policy_concept_id,
        policy_concept,
        policy_concept_description,
        turn_hash,
        turn_idx,
        text
    from {{ ref('phase2_transcript_curated_theme_tags') }}
    where turn_seq > 0
),

-- One row per (session, policy concept) pair that has candidates to review. The
-- fingerprint is over the pair's tagged turn_hashes, NOT the whole transcript: reviews
-- only need to re-run when the pair's tag set itself changes.
pairs as (
    select
        session_id,
        policy_concept_id,
        any_value(policy_concept) as policy_concept,
        any_value(policy_concept_description) as policy_concept_description,
        hash_agg(turn_hash) as pair_tag_fingerprint,
        count(*) as n_candidates,
        listagg('[' || turn_idx || '] ' || trim(text), '\n\n')
        within group (order by turn_idx) as candidates
    from tag_quotes
    group by session_id, policy_concept_id
),

-- noqa: disable=LT02
pending_pairs as (
    select p.*
    from pairs as p
    {% if is_incremental() %}
    where not exists (
        select 1 from {{ this }} as done
        where
            done.session_id = p.session_id
            and done.policy_concept_id = p.policy_concept_id
            and done.review_status = 'SUCCESS'
            and done.pair_tag_fingerprint = p.pair_tag_fingerprint
    )
    {% endif %}
),

reviewed as (
    select
        pp.*,
        pr.system_prompt,
        snowflake.cortex.try_complete(
            '{{ var("llm_model") }}',
            [
                { 'role': 'system', 'content': pr.system_prompt },
                { 'role': 'user', 'content':
                    pr.review_task_prompt
                    || '\n\nPolicy concept: ' || pp.policy_concept
                    || '\nConcept description: ' || pp.policy_concept_description
                    || '\n\nCandidates (format: [turn_idx] quote):\n' || pp.candidates
                    || '\n\nRespond ONLY with: {"keep_turn_idxs": [int, ...]} — the indices of candidates to KEEP. Indices must come from the list above.'
                }
            ],
            object_construct(
                'temperature', 0,
                'max_tokens', {{ llm_max_tokens }},
                -- annoyingly required to be one line.
                'response_format', parse_json('{"type":"json","schema":{"type":"object","properties":{"keep_turn_idxs":{"type":"array","items":{"type":"number"}}},"required":["keep_turn_idxs"],"additionalProperties":false}}')
            )
        ) as raw_response
    from pending_pairs as pp
    cross join prompts as pr
),
-- noqa: enable=LT02

extracted as (
    select
        session_id,
        policy_concept_id,
        policy_concept,
        pair_tag_fingerprint,
        n_candidates,
        coalesce(raw_response:usage:total_tokens::int, 0) as llm_tokens,
        try_parse_json(to_json(raw_response:structured_output[0]:raw_message)) as review_json
    from reviewed
),

parsed as (
    select
        *,
        case
            when review_json is null then 'FAILED'
            else 'SUCCESS'
        end as review_status
    from extracted
),

keep_idxs as (
    select distinct
        p.session_id,
        p.policy_concept_id,
        idx.value::int as keep_turn_idx
    from parsed as p,
        lateral flatten(input => p.review_json:keep_turn_idxs) as idx
    where p.review_status = 'SUCCESS'
),

-- One verdict per candidate of every SUCCESSFULLY reviewed pending pair: keep = the
-- model returned its index. Left-join miss = rejected.
verdicts as (
    select
        q.session_id,
        q.policy_concept_id,
        q.turn_hash,
        q.turn_idx,
        (k.keep_turn_idx is not null) as keep
    from tag_quotes as q
    inner join parsed as p
        on
            q.session_id = p.session_id
            and q.policy_concept_id = p.policy_concept_id
            and p.review_status = 'SUCCESS'
    left join keep_idxs as k
        on
            q.session_id = k.session_id
            and q.policy_concept_id = k.policy_concept_id
            and q.turn_idx = k.keep_turn_idx
),

-- Returned indices that were never candidates (guardrail: ignored, but counted — a
-- consistently nonzero count means the model is inventing indices).
pair_counts as (
    select
        k.session_id,
        k.policy_concept_id,
        count_if(q.turn_idx is null) as n_invented_idxs,
        count_if(q.turn_idx is not null) as n_kept
    from keep_idxs as k
    left join tag_quotes as q
        on
            k.session_id = q.session_id
            and k.policy_concept_id = q.policy_concept_id
            and k.keep_turn_idx = q.turn_idx
    group by k.session_id, k.policy_concept_id
),

verdict_rows as (
    select
        v.session_id,
        v.policy_concept_id,
        p.policy_concept,
        v.turn_hash,
        v.turn_idx,
        v.keep,
        p.n_candidates,
        coalesce(pc.n_kept, 0) as n_kept,
        coalesce(pc.n_invented_idxs, 0) as n_invented_idxs,
        p.review_status,
        p.pair_tag_fingerprint,
        p.llm_tokens
    from verdicts as v
    inner join parsed as p
        on
            v.session_id = p.session_id
            and v.policy_concept_id = p.policy_concept_id
    left join pair_counts as pc
        on
            v.session_id = pc.session_id
            and v.policy_concept_id = pc.policy_concept_id
),

-- One status row per reviewed pair, whatever its outcome — FAILED pairs appear ONLY
-- here (no verdict rows) and are retried on the next run.
status_rows as (
    select
        p.session_id,
        p.policy_concept_id,
        p.policy_concept,
        null::varchar as turn_hash,
        null::int as turn_idx,
        null::boolean as keep,
        p.n_candidates,
        coalesce(pc.n_kept, 0) as n_kept,
        coalesce(pc.n_invented_idxs, 0) as n_invented_idxs,
        p.review_status,
        p.pair_tag_fingerprint,
        p.llm_tokens
    from parsed as p
    left join pair_counts as pc
        on
            p.session_id = pc.session_id
            and p.policy_concept_id = pc.policy_concept_id
),

combined as (
    select * from status_rows
    union all
    select * from verdict_rows
)

select
    *,
    '{{ var("llm_model") }}' as llm_model,
    current_timestamp() as processed_at
from combined
