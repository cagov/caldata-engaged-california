#!/usr/bin/env python3
"""
Offline theme quality evaluation for AI impact survey analyses.

Reads saved analyses from GOVOCAL.AI_ANALYSIS_OUTPUTS,
reconstructs filtered respondent texts, and scores two metrics per theme
using Snowflake Cortex.

Metrics:
  faithfulness_quotes    (0.0–1.0)  Claims in theme description supported by its cited quotes
  faithfulness_grounding (0.0–1.0)  Share of filtered respondents who express the theme
  coverage               (0 or 1)   Whether the analysis captured major themes in the data

Usage:
  python evaluate.py                  # list saved analyses
  python evaluate.py <run_id>         # evaluate one run
  python evaluate.py <run_id> --json  # machine-readable output
"""

import argparse
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field

from dotenv import load_dotenv


QUESTION_COL_MAP = {
    "Personal AI impact": "PERSONAL_AI_IMPACT",
    "Economic impact":    "ECONOMIC_IMPACT_EXPECTATION",
    "Government action":  "GOVERNMENT_ACTION_SUGGESTION",
}

BATCH_SIZE = 25

_OUTPUTS_DB    = os.environ.get("OUTPUTS_DATABASE", "ANALYTICS_ENGCA_DEV")
_OUTPUTS_TABLE = f"{_OUTPUTS_DB}.GOVOCAL.AI_ANALYSIS_OUTPUTS"

_session = None


def _get_session():
    global _session
    if _session is None:
        load_dotenv()
        from snowflake.snowpark import Session
        _session = Session.builder.configs({
            "account":       os.environ["SNOWFLAKE_ACCOUNT"],
            "user":          os.environ["SNOWFLAKE_USER"],
            "authenticator": "externalbrowser",
            "role":          os.environ.get("SNOWFLAKE_ROLE", ""),
            "warehouse":     os.environ.get("SNOWFLAKE_WAREHOUSE", ""),
        }).create()
    return _session


def _esc(s: str) -> str:
    return s.replace("'", "''")


_JUDGE_SYSTEM_PROMPT = (
    "You are a precise classification assistant performing natural language inference. "
    "Follow the requested output format exactly. Do not add commentary outside that format."
)


def _cortex(prompt: str, model: str) -> dict:
    session = _get_session()
    query = f"""
    SELECT SNOWFLAKE.CORTEX.COMPLETE(
        '{_esc(model)}',
        ARRAY_CONSTRUCT(
            OBJECT_CONSTRUCT('role', 'system', 'content', '{_esc(_JUDGE_SYSTEM_PROMPT)}'),
            OBJECT_CONSTRUCT('role', 'user', 'content', '{_esc(prompt)}')
        ),
        OBJECT_CONSTRUCT('temperature', 0)
    ) AS result
    """
    row = session.sql(query).to_pandas().iloc[0]
    return json.loads(row["RESULT"])


@dataclass
class ThemeMetrics:
    label: str
    description: str
    quotes: list[str]
    faithfulness_quotes: float
    faithfulness_grounding: float
    grounding_detail: dict = field(default_factory=dict)


@dataclass
class AnalysisMetrics:
    run_id: str
    question: str
    filters: dict
    n_respondents: int
    model: str
    theme_metrics: list[ThemeMetrics]
    coverage: int
    coverage_reasoning: str


def parse_themes_with_quotes(text: str) -> list[tuple[str, str, list[str]]]:
    results = []
    sections = re.split(r'(?=####\s*\d+\.)', text)
    for section in sections:
        label_match = re.match(r'####\s*\d+\.\s*(.+)', section.strip())
        if not label_match:
            continue
        label = re.sub(r'\*+', '', label_match.group(1)).strip()
        desc_match = re.search(r'\*Description:\s*([^*]+?)\*', section, re.DOTALL)
        description = re.sub(r'\[cite:\d+\]', '', desc_match.group(1)).strip() if desc_match else label
        quotes: list[str] = []
        quotes_block = re.search(r'\*Representative quotes:\*\s*\n((?:- .+\n?)+)', section)
        if quotes_block:
            for line in quotes_block.group(1).splitlines():
                line = re.sub(r'\[cite:\d+\]', '', line.strip().lstrip("- ")).strip()
                if len(line) > 10:
                    quotes.append(line)
        results.append((label, description, quotes))
    return results


def _decompose_claims(theme_description: str, model: str) -> list[str]:
    prompt = (
        "Break the following theme description into a list of simple, standalone, checkable claims. "
        "If the theme is already a single atomic claim, return a list with just that one claim. "
        "Respond with ONLY a JSON array of strings, no other text.\n\n"
        f"Theme: {theme_description}"
    )
    result = _cortex(prompt, model)
    raw = result["choices"][0]["messages"]
    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if match:
        try:
            claims = json.loads(match.group())
            if isinstance(claims, list) and claims:
                return [str(c) for c in claims]
        except json.JSONDecodeError:
            pass
    return [theme_description]


def score_faithfulness_quotes(
    theme_description: str,
    quotes: list[str],
    model: str,
) -> tuple[float, dict]:
    if not quotes:
        return 0.0, {"error": "no quotes to evaluate"}

    claims = _decompose_claims(theme_description, model)
    claims_text = "\n".join(f"- {c}" for c in claims)
    quotes_text = "\n".join(f"[{i + 1}] {q}" for i, q in enumerate(quotes))

    prompt = (
        "For each claim below, determine whether it is directly supported by at least one "
        "of the survey quotes provided.\n\n"
        f"Claims:\n{claims_text}\n\n"
        f"Quotes:\n{quotes_text}\n\n"
        "Output one line per claim:\n"
        "Claim N: yes or no\n"
        "Output only those lines — no other text."
    )

    result = _cortex(prompt, model)
    raw    = result["choices"][0]["messages"]

    verdicts: list[bool] = []
    for m in re.finditer(r'Claim\s+(\d+):\s*(yes|no)', raw, re.IGNORECASE):
        idx = int(m.group(1)) - 1
        if 0 <= idx < len(claims):
            verdicts.append(m.group(2).lower() == "yes")

    if not verdicts:
        yes   = len(re.findall(r'\byes\b', raw, re.IGNORECASE))
        no    = len(re.findall(r'\bno\b',  raw, re.IGNORECASE))
        total = yes + no
        score = yes / total if total else 0.0
    else:
        score = sum(1 for v in verdicts if v) / len(claims)

    return score, {
        "claims":           claims,
        "n_quotes":         len(quotes),
        "supported_claims": sum(1 for v in verdicts if v),
        "total_claims":     len(claims),
        "score":            score,
    }


def score_faithfulness_grounding(
    theme_description: str,
    responses: list[tuple[str, str]],
    model: str,
    max_workers: int = 12,
) -> tuple[float, dict]:
    if not responses:
        return 0.0, {"error": "no responses"}

    id_to_int = {uid: i + 1 for i, (uid, _) in enumerate(responses)}
    int_to_id = {v: k for k, v in id_to_int.items()}
    batches   = [responses[i:i + BATCH_SIZE] for i in range(0, len(responses), BATCH_SIZE)]

    def _score_batch(batch: list[tuple[str, str]]) -> tuple[dict[str, bool], int]:
        parts  = [f"[cite:{id_to_int[uid]}] {text.strip()}" for uid, text in batch]
        prompt = (
            f"For each survey response below, judge whether it expresses or directly supports "
            f"the following theme.\n\n"
            f"Theme: {theme_description}\n\n"
            f"Responses:\n" + "\n".join(parts) + "\n\n"
            f"Output one line per response, exactly: [cite:N]: yes or no\n"
            f"Output only those lines — no other text."
        )
        result   = _cortex(prompt, model)
        raw      = result["choices"][0]["messages"]
        tokens   = result["usage"]["total_tokens"]
        verdicts: dict[str, bool] = {}
        for m in re.finditer(r'\[cite:(\d+)\]:\s*(yes|no)', raw, re.IGNORECASE):
            uid = int_to_id.get(int(m.group(1)))
            if uid:
                verdicts[uid] = m.group(2).lower() == "yes"
        return verdicts, tokens

    all_verdicts: dict[str, bool] = {}
    total_tokens = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_score_batch, b): None for b in batches}
        for future in as_completed(futures):
            try:
                verdicts, tokens = future.result()
                all_verdicts.update(verdicts)
                total_tokens += tokens
            except Exception as e:
                print(f"  Warning: batch failed — {e}")

    n_matched = sum(1 for v in all_verdicts.values() if v)
    n_total   = len(responses)
    score     = n_matched / n_total if n_total else 0.0

    return score, {
        "n_matched":    n_matched,
        "n_total":      n_total,
        "total_tokens": total_tokens,
        "score":        score,
    }


def score_coverage(
    analysis_text: str,
    response_sample: list[str],
    model: str,
) -> tuple[int, str]:
    sample_text = "\n".join(f"- {r.strip()}" for r in response_sample[:50])
    prompt = (
        "You are evaluating the quality of an AI-generated thematic analysis of survey responses.\n\n"
        "GENERATED ANALYSIS:\n"
        f"{analysis_text[:3000]}\n\n"
        "SAMPLE OF ACTUAL SURVEY RESPONSES:\n"
        f"{sample_text}\n\n"
        "Does the analysis capture the most important recurring themes from the responses? "
        "Are there clear patterns in the responses that the analysis completely missed?\n\n"
        'Respond with ONLY a JSON object: {"verdict": 1 or 0, "reasoning": "one or two sentences"}\n'
        "1 = comprehensive, 0 = important themes were missed."
    )
    result = _cortex(prompt, model)
    raw    = result["choices"][0]["messages"]
    match  = re.search(r'\{.*\}', raw, re.DOTALL)
    if match:
        try:
            parsed    = json.loads(match.group())
            verdict   = int(parsed.get("verdict", 0))
            reasoning = str(parsed.get("reasoning", raw.strip()))
            return verdict, reasoning
        except (json.JSONDecodeError, ValueError):
            pass
    return 0, raw.strip()


def list_saved_analyses() -> list[dict]:
    session = _get_session()
    df = session.sql("""
        SELECT
            ID,
            SAVED_AT,
            QUESTION,
            MODEL,
            N_RESPONDENTS,
            LEFT(ANALYSIS_TEXT, 80) AS PREVIEW
        FROM {_OUTPUTS_TABLE}
        ORDER BY SAVED_AT DESC
        LIMIT 20
    """).to_pandas()
    return df.to_dict("records")


def load_saved_analysis(run_id: str) -> dict:
    session = _get_session()
    df = session.sql(f"""
        SELECT
            ID,
            SAVED_AT,
            QUESTION,
            FILTERS,
            ANALYSIS_TEXT,
            RESPONDENT_IDS,
            MODEL,
            N_RESPONDENTS
        FROM {_OUTPUTS_TABLE}
        WHERE ID = '{_esc(run_id)}'
    """).to_pandas()
    if df.empty:
        raise ValueError(f"No saved analysis found with ID: {run_id}")
    row = df.iloc[0]
    return {
        "run_id":         str(row["ID"]),
        "saved_at":       str(row["SAVED_AT"]),
        "question":       str(row["QUESTION"]),
        "filters":        json.loads(row["FILTERS"]) if isinstance(row["FILTERS"], str) else (row["FILTERS"] or {}),
        "analysis_text":  str(row["ANALYSIS_TEXT"]),
        "respondent_ids": json.loads(row["RESPONDENT_IDS"]) if isinstance(row["RESPONDENT_IDS"], str) else list(row["RESPONDENT_IDS"]),
        "model":          str(row["MODEL"]),
        "n_respondents":  int(row["N_RESPONDENTS"]),
    }


def fetch_respondent_texts(idea_ids: list[str], answer_col: str) -> list[tuple[str, str]]:
    session  = _get_session()
    ids_sql  = ", ".join(f"'{_esc(str(uid))}'" for uid in idea_ids)
    df = session.sql(f"""
        SELECT SURVEY_ID AS IDEA_ID, {answer_col}
        FROM ANALYTICS_ENGCA_PRD.GOVOCAL.GOVOCAL_AI_SURVEY_RESPONDENTS
        WHERE SURVEY_ID IN ({ids_sql})
          AND {answer_col} IS NOT NULL
          AND TRIM({answer_col}) != ''
    """).to_pandas()
    return [(str(row["IDEA_ID"]), str(row[answer_col])) for _, row in df.iterrows()]


def evaluate(run_id: str, verbose: bool = True) -> AnalysisMetrics:
    if verbose:
        print(f"\n{'=' * 60}")
        print(f"Loading saved analysis: {run_id}")

    saved      = load_saved_analysis(run_id)
    model      = saved["model"]
    answer_col = QUESTION_COL_MAP.get(saved["question"])

    if not answer_col:
        raise ValueError(f"Unknown question: {saved['question']!r}")

    if verbose:
        print(f"Question:     {saved['question']}")
        print(f"Respondents:  {saved['n_respondents']}")
        print(f"Model:        {model}")
        print(f"Saved at:     {saved['saved_at']}")
        print(f"{'=' * 60}")
        print(f"\nFetching respondent texts…")

    all_responses = fetch_respondent_texts(saved["respondent_ids"], answer_col)

    if verbose:
        print(f"Got {len(all_responses)} non-empty responses")

    themes_data = parse_themes_with_quotes(saved["analysis_text"])

    if not themes_data:
        raise ValueError(
            "No themes found in analysis text. "
            "Only Thematic Analysis outputs can be evaluated."
        )

    if verbose:
        print(f"Found {len(themes_data)} themes\n")

    theme_metrics: list[ThemeMetrics] = []

    for label, description, quotes in themes_data:
        if verbose:
            print(f"  Theme: {label}")
            print(f"  ├─ Scoring quote faithfulness ({len(quotes)} quotes)…")

        fq_score, fq_detail = score_faithfulness_quotes(description, quotes, model)

        if verbose:
            print(f"  │  faithfulness_quotes    = {fq_score:.2f}")
            print(f"  └─ Scoring grounding ({len(all_responses)} respondents)…")

        fg_score, fg_detail = score_faithfulness_grounding(description, all_responses, model)

        if verbose:
            print(f"     faithfulness_grounding = {fg_score:.2f}  "
                  f"({fg_detail['n_matched']}/{fg_detail['n_total']} respondents)\n")

        theme_metrics.append(ThemeMetrics(
            label=label,
            description=description,
            quotes=quotes,
            faithfulness_quotes=fq_score,
            faithfulness_grounding=fg_score,
            grounding_detail=fg_detail,
        ))

    if verbose:
        print(f"  Scoring coverage…")

    sample_texts = [text for _, text in all_responses[:50]]
    coverage, coverage_reasoning = score_coverage(saved["analysis_text"], sample_texts, model)

    if verbose:
        print(f"  coverage = {coverage} — {coverage_reasoning}\n")

    return AnalysisMetrics(
        run_id=run_id,
        question=saved["question"],
        filters=saved["filters"],
        n_respondents=saved["n_respondents"],
        model=model,
        theme_metrics=theme_metrics,
        coverage=coverage,
        coverage_reasoning=coverage_reasoning,
    )


def print_report(metrics: AnalysisMetrics) -> None:
    W = 62
    print(f"\n{'=' * W}")
    print("EVALUATION REPORT")
    print(f"{'=' * W}")
    print(f"Run ID:      {metrics.run_id}")
    print(f"Question:    {metrics.question}")
    print(f"Respondents: {metrics.n_respondents}")
    print(f"Model:       {metrics.model}")

    print(f"\n{'─' * W}")
    print("THEME SCORES")
    print(f"{'─' * W}")
    print(f"{'Theme':<36} {'Quote Fidelity':>15} {'Grounding':>10}")
    print(f"{'─' * 36} {'─' * 15} {'─' * 10}")

    for tm in metrics.theme_metrics:
        label_short = (tm.label[:34] + "..") if len(tm.label) > 36 else tm.label
        print(f"{label_short:<36} {tm.faithfulness_quotes:>15.2f} {tm.faithfulness_grounding:>10.2f}")

    if metrics.theme_metrics:
        avg_fq = sum(t.faithfulness_quotes    for t in metrics.theme_metrics) / len(metrics.theme_metrics)
        avg_fg = sum(t.faithfulness_grounding for t in metrics.theme_metrics) / len(metrics.theme_metrics)
        print(f"{'─' * 36} {'─' * 15} {'─' * 10}")
        print(f"{'Average':<36} {avg_fq:>15.2f} {avg_fg:>10.2f}")

    print(f"\n{'─' * W}")
    print(f"COVERAGE: {metrics.coverage} / 1")
    print(f"Reasoning: {metrics.coverage_reasoning}")
    print(f"{'=' * W}\n")


def to_json(metrics: AnalysisMetrics) -> str:
    return json.dumps({
        "run_id":             metrics.run_id,
        "question":           metrics.question,
        "n_respondents":      metrics.n_respondents,
        "model":              metrics.model,
        "coverage":           metrics.coverage,
        "coverage_reasoning": metrics.coverage_reasoning,
        "themes": [
            {
                "label":                  t.label,
                "faithfulness_quotes":    round(t.faithfulness_quotes,    4),
                "faithfulness_grounding": round(t.faithfulness_grounding, 4),
                "n_matched":              t.grounding_detail.get("n_matched"),
                "n_total":                t.grounding_detail.get("n_total"),
            }
            for t in metrics.theme_metrics
        ],
        "averages": {
            "faithfulness_quotes":    round(
                sum(t.faithfulness_quotes for t in metrics.theme_metrics) / len(metrics.theme_metrics), 4
            ) if metrics.theme_metrics else None,
            "faithfulness_grounding": round(
                sum(t.faithfulness_grounding for t in metrics.theme_metrics) / len(metrics.theme_metrics), 4
            ) if metrics.theme_metrics else None,
        },
    }, indent=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate saved AI impact survey analyses")
    parser.add_argument("run_id", nargs="?", help="Run ID from AI_ANALYSIS_OUTPUTS table")
    parser.add_argument("--list",  action="store_true", help="List the 20 most recent saved analyses")
    parser.add_argument("--json",  action="store_true", help="Output results as JSON")
    parser.add_argument("--quiet", action="store_true", help="Suppress progress output")
    args = parser.parse_args()

    if args.list or not args.run_id:
        print("\nSaved analyses:")
        print(f"{'ID':<38} {'Saved At':<22} {'Question':<22} {'N':>6}  Preview")
        print(f"{'─' * 38} {'─' * 22} {'─' * 22} {'─' * 6}  {'─' * 30}")
        for row in list_saved_analyses():
            preview = str(row.get("PREVIEW", "")).replace("\n", " ")[:30]
            print(
                f"{str(row['ID']):<38} "
                f"{str(row['SAVED_AT']):<22} "
                f"{str(row['QUESTION']):<22} "
                f"{row['N_RESPONDENTS']:>6}  "
                f"{preview}…"
            )
        print()
    else:
        metrics = evaluate(args.run_id, verbose=not args.quiet)
        if args.json:
            print(to_json(metrics))
        else:
            print_report(metrics)
