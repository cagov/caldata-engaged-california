# Codebook changelog

## 2026-08-18d (2026-08-19)

Replaces v2 outright with `files-svelte/codebooks.json` as authored (112
codes: economy 35, government 37, personal 40) — a verbatim adoption, not a
merge; no theme definition was written or edited as part of this change.

**Lineage note:** this version's own `supersedes` field says `2026-08-10`, so
it branches off v1.1-questions-fixed, *not* off v2 below. 23 v2 code names
have no like-named counterpart here, including all 19 personal themes adopted
in the 2026-08-12 merge session. Several are renames rather than losses
(mapping below is a best-effort read of matching definitions, not confirmed
against the discovery transcript):

- `TRAINING_OWN_REPLACEMENT` → `TRAINING_REPLACEMENT`
- `HIRING_SCREENING` → `HIRING_PROCESS_AI`
- `DESKILLING` → split across `COGNITIVE_ATROPHY` / `SKILL_PRESSURE`
- `MANDATED_USE`, `IP_THEFT`, `AI_IS_THE_JOB`, `POWER_WEALTH_CONCENTRATION`
  reappear as `MANDATED_USE`/`TOOL_IMPOSED`, `IP_TAKEN`, `WORK_TRANSFORMED`
  (partial), and `INEQUALITY`/`WEALTH_CONCENTRATION_MECHANISM` respectively —
  not verified 1:1.
- Remaining v2-only names with no apparent 2026-08-18d counterpart:
  `QUALITY_DEGRADATION`, `INDUSTRY_CONTRACTION`, `MARKET_FLOODING`,
  `ENTRY_LEVEL_COLLAPSE`, `AI_AS_PRETEXT`, `AI_INVESTMENT_DIVERSION`,
  `GOVERNANCE_GAP`, `ETHICAL_ENVIRONMENTAL_OBJECTION`, `PUBLIC_SECTOR_LAG`,
  `HEALTHCARE_AI_RISK`, `AI_ACCESS_INEQUITY`, `ALGORITHMIC_BIAS_DUE_PROCESS`,
  `BUBBLE_CRASH`, `ENTRY_LEVEL_PIPELINE`, `WHITE_COLLAR_MIDDLE_CLASS`,
  `CREATIVE_LABOR_HARM`, `WAGES_PRICES` (economy; retired within
  2026-08-18d itself, see `retiredCodes` in the codebook file).

Nothing is invalidated: no `labels.jsonl` was ever produced against v2, so
there is no prior classification to migrate.

**Question wording corrected on adoption:** the source file's three `prompt`
fields had drifted from the verbatim survey wording (the same "wrong wording"
problem that CHANGELOG entry 1.1-questions-fixed already fixed once) —
economy said "affect" instead of "impact," government was paraphrased down to
"What should government do about AI?", and personal reinstated the pre-fix
"How has AI affected you personally, and..." framing. All three were
corrected in place to match `config.ts`'s `QUESTIONS` (and the README) exactly.
No theme code, definition, include/exclude, or example was touched.

**Needs verification before publication:** `personal/NOT_ADOPTED` is flagged
`verification: "needs_verification"` in the codebook (also the only theme with
an empty `examples` array) — proposed by a coding pass but never backed by a
citable quote. Per the codebook's own `verification._why` note, this failure
mode requires the model to invent a response ID and so does not block a
tagging pass where IDs come from the input row — but its prevalence number
must be checked against verbatims before it's reported.

## 2 (2026-08-12)

Partial human merge session against `reports/codebook-merge.md` — not
exhaustive by design; Genevieve reviewed and decided 35 of the 95 discovery
candidates (personal: 31/37, economy: 4/28, government: 0/30). The remaining
60 stay undecided and out of v2; they can go through a future merge pass
without touching anything decided here.

**Adopted — personal (19 new themes):** `MANDATED_USE`, `QUALITY_DEGRADATION`,
`INDUSTRY_CONTRACTION`, `TRAINING_OWN_REPLACEMENT`, `HIRING_SCREENING`,
`IP_THEFT`, `MARKET_FLOODING`, `DESKILLING`, `ENTRY_LEVEL_COLLAPSE`,
`AI_AS_PRETEXT`, `AI_INVESTMENT_DIVERSION`, `GOVERNANCE_GAP`,
`ETHICAL_ENVIRONMENTAL_OBJECTION`, `AI_IS_THE_JOB`, `PUBLIC_SECTOR_LAG`,
`POWER_WEALTH_CONCENTRATION`, `HEALTHCARE_AI_RISK`, `AI_ACCESS_INEQUITY`,
`ALGORITHMIC_BIAS_DUE_PROCESS`.

**Adopted — economy (4 new themes):** `BUBBLE_CRASH`, `ENTRY_LEVEL_PIPELINE`,
`WHITE_COLLAR_MIDDLE_CLASS`, `CREATIVE_LABOR_HARM`.

**Merged into an existing/adopted theme (personal):**
- `APPLICANT_AI_USE` → `HIRING_SCREENING` (candidates' own AI use frustrating
  hiring assessment, folded into the hiring-screening theme's scope note)
- `PHYSICAL_AUTOMATION` → `JOB_LOST` (robotics/physical automation as a cause
  of job loss, folded into the existing theme's scope note)

**Rejected (personal, 10):** `AI_USAGE_METRICS`, `SURVEILLANCE`,
`AI_MENTAL_HEALTH`, `AGE_DISCRIMINATION`, `WORKPLACE_TENSION`,
`IT_INFRASTRUCTURE_STRAIN`, `AUTOMATED_SCHEDULING_HARM`, `CONFUSED_OFFTOPIC`,
`ACCESSIBILITY_BENEFIT`, `AI_CLIENTELE_CULTURE`.

**Deferred — not yet reviewed, not in v2:**
- personal (6): `DATA_PRIVACY`, `FORCED_INTEGRATION`,
  `CUSTOMER_SERVICE_DEGRADATION`, `CLIENT_MISINFORMED`, `HYPE_MISMATCH`,
  `MORALE_STRESS`
- economy (24): `AI_LITERACY_DIVIDE`, `COGNITIVE_DECLINE`,
  `LOSS_OF_HUMAN_CONTACT`, `REGULATION_NEEDED`, `HISTORICAL_ANALOGY`,
  `SOCIAL_UNREST_CRIME`, `NEGATIVE_UNSPECIFIED`, `IP_THEFT`,
  `TAX_BASE_EROSION`, `HIRING_SCREENING_BARRIER`, `SMALL_BUSINESS_EFFECTS`,
  `FRAUD_SECURITY_TRUST`, `SURVEILLANCE_WORKER_POWER`, `UBI_SAFETY_NET`,
  `REGIONAL_DISPARITY`, `EXISTENTIAL_CATASTROPHE`, `NOBODY_WANTS_IT`,
  `CAPITAL_CROWDING_OUT`, `OFFSHORING_CONTRACTING`, `SURVEILLANCE_PRIVACY`,
  `CONSUMER_DISINTERMEDIATION`, `AI_TRAINING_GIG_WORK`,
  `HOUSING_COST_PRESSURE`, `MILITARY_LAW_ENFORCEMENT_USE`
- government (30, entire question deferred): `MISINFO_DEEPFAKE`,
  `GOVT_ADOPT_AI`, `ANTITRUST`, `BUBBLE_NO_BAILOUT`, `PUBLIC_CONSULTATION`,
  `GOVT_DISTRUST`, `STUDY_MONITOR`, `SLOW_DOWN`, `HUMAN_DIGNITY_MEANING`,
  `JOB_CREATION`, `ETHICS_VALUES`, `USE_AI_FOR_GOOD`, `SURVEILLANCE`,
  `GOVT_AI_GUIDELINES`, `INTERNATIONAL_COORD`, `MONEY_IN_POLITICS`,
  `DISCRIMINATION_BIAS`, `CUSTOMER_SERVICE_HUMANS`, `NAMING_MARKETING`,
  `PROSECUTE_EXECUTIVES`, `OFFTOPIC_OTHER`, `MILITARY_LETHAL`,
  `SHORTER_WORKWEEK`, `NO_PERSONIFICATION`, `KNOWLEDGE_OWNERSHIP`,
  `GOVERNANCE_REDESIGN`, `IMMIGRATION_OFFSHORING`, `PROCUREMENT_STANDARDS`,
  `UNREST_WARNING`, `SPECIFIC_FRAMEWORK_CITED`

Government's baseline v1.1 themes are unchanged and still classifiable —
only its candidate expansion is deferred. Classification below runs against
this v2 codebook as-is; government prevalence numbers will reflect the
original 15 themes only, not the deferred 30.

## 1.1-questions-fixed (2026-08-11)
- Corrected all three question prompts to exact instrument wording
  (PERSONAL was previously "How has AI affected you personally?" — wrong construct).
- Removed stance axis and nonAnswers list (moved to status stages s03/s04).
- Themes untouched: still the 43 seeded from the 13-response sample. v2 comes
  from the human merge session after discovery.
