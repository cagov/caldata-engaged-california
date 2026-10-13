#!/usr/bin/env python3
"""
Generates the SUBTHEMES + CONCEPTS JS literal for
sketches/concept-distillation-real-phase2-themes.html.

Phase 2 side (the 27 policy concepts, their subtheme/theme, and their
sessions/votes/ideas/composite numbers) is read verbatim from the human
source-of-truth sheet — nothing here invents or edits that half.

Phase 1 side does not exist yet (no coded Phase 1 taxonomy). The `CHILDREN`
table below is hand-authored placeholder phrasing; each child's *weight* is
real, though: the number of Phase 1 open-text respondents (of 2,514) whose
answers match that child's keyword regex. Swapping in a real Phase 1
codebook later means replacing CHILDREN — everything else here is reusable.

Read-only against data/. Prints JS to stdout; paste into the HTML's
SUBTHEMES/CONCEPTS block by hand (this is a generator, not a build step).
"""
import csv
import re

SOURCE_OF_TRUTH = (
    "data/Copy of Source of truth - Policy concepts, descriptions, subthemes, "
    "themes - Policy concepts, descriptions, subthemes, themes (1).csv"
)
PHASE1_OPENTEXT = "data/all_phase1_opentext_responses.csv"
COMPOSITE_COL = "Composite metric order (percentrank session% + percentrank top)"

# ── 1. Phase 2: read the source of truth verbatim ──────────────────────────

with open(SOURCE_OF_TRUTH, newline="", encoding="utf-8") as f:
    rows = [r for r in csv.DictReader(f) if r["Policy concept"].strip()]

assert len(rows) == 27, f"expected 27 policy concepts, got {len(rows)}"

# Subthemes, in first-seen order, mapped to their theme and a legend-safe
# short name. (short name, theme index) — theme names/order below.
THEMES = [
    "Making rules for AI companies",
    "Protecting our way of life",
    "Learning about and adapting to AI",
]
SUBTHEME_META = {
    "Protecting people and nature from the effects of AI": ("People & nature", 0, "#2479b7"),
    "Regulating how AI works and where it’s used": ("How & where AI is used", 0, "#a350c4"),
    "Protecting jobs and workers": ("Jobs & workers", 1, "#d93920"),
    "Making sure the public has their say on AI impacts that affect them": ("Public's say", 1, "#28806d"),
    "Empowering people to protect their data": ("Personal data", 1, "#aa640e"),
    "Preserving the rights of humans to choose and decide": ("Human choice", 1, "#6d4884"),
    "Protecting kids and education": ("Kids & education", 1, "#66793f"),
    "Increasing AI research and literacy": ("Research & literacy", 2, "#478036"),
}

subtheme_order = []
for r in rows:
    st = r["Subtheme"]
    if st not in subtheme_order:
        subtheme_order.append(st)
assert len(subtheme_order) == 8, f"expected 8 subthemes, got {len(subtheme_order)}"

subtheme_index = {st: i for i, st in enumerate(subtheme_order)}

# ── 2. Phase 1: keyword frequency over the real open-text corpus ───────────

csv.field_size_limit(10**7)
with open(PHASE1_OPENTEXT, newline="", encoding="utf-8") as f:
    p1rows = list(csv.DictReader(f))
FREE_TEXT_COLS = [
    "ECONOMIC_IMPACT_EXPECTATION",
    "GOVERNMENT_ACTION_SUGGESTION",
    "PERSONAL_AI_IMPACT",
]
CORPUS = [
    " ".join((r[c] or "") for c in FREE_TEXT_COLS).lower() for r in p1rows
]
_COUNT_CACHE = {}


def kw_count(pattern):
    """Respondents (of len(CORPUS)) whose combined free text matches pattern."""
    if pattern not in _COUNT_CACHE:
        rx = re.compile(pattern)
        _COUNT_CACHE[pattern] = sum(1 for b in CORPUS if rx.search(b))
    return _COUNT_CACHE[pattern]


# Placeholder Phase 1 children per Phase 2 concept: (label, regex).
# Labels are invented (no Phase 1 codebook exists yet); weights are real
# keyword counts against the 2,514-respondent Phase 1 open-text corpus.
CHILDREN = {
    "Hold AI companies liable for harm they cause": [
        ("who's liable when AI causes harm", r"liab|accountab"),
        ("AI bias causing real harm", r"bias|discriminat"),
        ("no clear recourse when AI causes harm", r"recourse|sue (the company|ai)|legal action"),
        ("AI making medical decisions", r"medical (decision|diagnosis)|healthcare ai|ai (doctor|diagnos)"),
        ("AI replacing radiologists and doctors", r"radiolog|replace.*(doctor|physician)|diagnos.*ai"),
        ("AI in insurance decisions", r"insurance (industry|company|companies|rate|premium|denial)"),
        ("rising healthcare costs tied to AI", r"health.?care cost|medical (bill|cost)"),
        ("distrust of AI companies", r"don.t trust|distrust|trust.*(compan|corporation)"),
    ],
    "Protect people and nature from the resource needs of data centers": [
        ("data centers near homes", r"data cent"),
        ("cooling water demand", r"water"),
        ("electricity costs and grid strain", r"electricit|the grid"),
        ("renewable energy tradeoffs", r"renewable|solar|wind (power|energy)"),
        ("noise and falling property values", r"noise|property value"),
        ("drought tradeoffs", r"drought"),
        ("AI's carbon footprint", r"carbon (footprint|emission)|emissions"),
        ("local approval fights over new sites", r"local (approval|permit|zoning)|city council|planning commission"),
        ("data centers owned out of state", r"foreign.own|out.of.state"),
    ],
    "Set rules for where AI can be used safely": [
        ("AI screening job applicants", r"hiring|resume|job applica|interview"),
        ("AI making high-stakes decisions unfairly", r"bias|discriminat"),
        ("scams and fraud using AI", r"\bscam|fraud(ulent)?|phishing"),
        ("AI in elections and misinformation", r"election"),
        ("military and weapons use of AI", r"military|weapon(ize)?|autonomous weapon|warfare"),
        ("self-driving vehicles and safety", r"self.driving|autonomous vehicle|driverless"),
        ("AI replacing lawyers and legal work", r"lawyer|legal (work|job|profession)|paralegal"),
    ],
    "Set rules around how AI works": [
        ("companies won't explain how AI decides", r"transparen"),
        ("no way to audit the algorithms", r"audit"),
        ("AI is a black box", r"black box"),
        ("AI gives wrong or made-up answers", r"hallucinat|inaccurate|makes things up|gives wrong (answer|information)"),
        ("AI moving too fast to regulate safely", r"moving too fast|happening too fast|too fast for"),
        ("ban or pause AI development", r"\bban ai|pause ai|halt ai (development)?|stop (developing|building) ai"),
        ("need safety testing before release", r"safety test|test(ed|ing) before (release|deploy)|pre.market test"),
    ],
    "Deter layoffs because of AI, reward firms that keep or add workers": [
        ("afraid of being laid off", r"layoff|laid off|job loss"),
        ("small businesses keeping staff", r"small business"),
        ("white-collar jobs at risk too", r"white.collar|office job"),
        ("customer service jobs cut", r"customer service|call center"),
        ("creative jobs replaced by AI", r"graphic design|illustrat|voice actor|copywrit"),
        ("middle-class jobs squeezed", r"middle class"),
        ("programmers and coders losing work", r"programmer|software (engineer|developer)|coding job"),
        ("automation replacing routine work broadly", r"automat(e|ion|ing)"),
        ("productivity gains from AI", r"productiv(e|ity)"),
        ("inflation and cost of living", r"inflation|cost of living"),
        ("farm and agricultural jobs affected", r"farm(ing|er)|agricultur"),
        ("truck driving and transportation jobs", r"truck driv|delivery driver|transportation job"),
        ("AI creating new kinds of jobs", r"new (kind|type)s? of job|jobs we can.t (imagine|predict)|create new job"),
    ],
    "Make AI policymaking more open to the public": [
        ("want a real say in AI policy", r"public (input|say|voice|involve)|town hall|citizen"),
        ("AI industry writing its own rules", r"lobby|industry.captur|revolving door|special interest"),
        ("other countries moving faster on AI", r"china|global ai race"),
        ("distrust of AI companies", r"don.t trust|distrust|trust.*(compan|corporation)"),
        ("federal vs. state authority over AI", r"federal (law|regulat)|state (law|regulat).*ai|preemption"),
        ("create a dedicated AI oversight agency", r"oversight (board|agency|committee)|regulatory (body|agency)|new agency"),
    ],
    "Make companies follow rules and be open about how they handle personal data": [
        ("companies collecting personal data", r"privacy|personal data"),
        ("monitored at work", r"surveillance|monitor(ed|ing) (my|employees|workers)"),
        ("data breaches and hacking", r"data breach|hack(ed|ing)|leaked (data|information)"),
        ("data sold to third parties", r"sold? (my|our|user) data|sell.*data|data broker"),
        ("facial recognition and biometric tracking", r"facial recognition|biometric|fingerprint scan"),
    ],
    "Make companies reskill or give career help to workers who lose their jobs to AI": [
        ("need retraining programs", r"retrain|reskill|upskill"),
        ("employer-funded training", r"training program|workforce develop"),
        ("community college and career pathways", r"community college"),
        ("gig work as a fallback", r"gig (economy|work)|freelanc"),
    ],
    "Set rules for labeling when AI is used": [
        ("want AI content labeled", r"label|disclos|watermark"),
        ("can't tell what's AI-generated", r"misinformation|deepfake|fake (news|video|image)"),
        ("deepfakes of real people", r"deepfake|likeness|voice clone"),
        ("voice cloning used in scams", r"voice clon|impersonat"),
    ],
    "Restrict and tax AI companies’ profits": [
        ("profits going to shareholders", r"profit|shareholder|executive (pay|bonus)"),
        ("small businesses can't compete", r"small business"),
        ("big tech has too much power", r"monopol|big tech|too much power|concentrat.*power"),
        ("robot tax proposals", r"robot tax|tax (the )?robot|tax automation"),
        ("tax AI companies to fund social programs", r"tax.*(fund|pay for)|use tax revenue"),
        ("AI widening the gap between rich and poor", r"(rich|wealthy|elite) (get|benefit)|widening (the )?gap|rich get richer"),
    ],
    "Hold AI companies liable if they use the work of others without permission": [
        ("artists uncompensated for their work", r"copyright|intellectual property|plagiar|artist"),
        ("scraped without consent", r"consent|opt.out"),
        ("musicians and authors uncompensated", r"musician|songwrit|author.*(compensat|royalt)"),
        ("AI replacing artists in games and film", r"video game|film industry|animat(ion|or)"),
        ("AI trained on copyrighted work specifically", r"trained on (my|their|copyrighted)|scraped (my|their|the) (work|content|art)"),
        ("protect journalism from AI", r"journalis|news (industry|media)"),
    ],
    "Make people aware of how to use AI ethically": [
        ("teach ethical AI use", r"\bethic"),
        ("need AI literacy programs", r"ai literacy|media literacy"),
        ("need public AI literacy campaigns", r"public (campaign|awareness).*ai|ai awareness campaign"),
        ("digital divide and rural access", r"digital divide|rural (access|internet)|broadband access"),
        ("AI translation and language access", r"translat(e|ion)|language (barrier|access)"),
    ],
    "Improve AI education in schools": [
        ("AI in the classroom", r"school|student|teacher"),
        ("students using AI to cheat", r"cheat|plagiar|homework|essay"),
        ("teachers replaced or assisted by AI", r"teacher.*(replace|assist|aid)|ai (teaching|tutor)"),
        ("AI in college admissions", r"college admission|admissions essay"),
    ],
    "Allow people to opt out of AI and make that easier": [
        ("hard to opt out of AI", r"opt.out"),
        ("forced to use AI with no choice", r"forced to use ai|refuse to use ai|no choice but to use ai|required to use ai"),
    ],
    "Support independent research on AI's effects": [
        ("fund independent research on AI risks", r"fund.*research|independent research|research grant"),
        ("unknown long-term effects", r"unknown (risk|effect|impact)|long.term (risk|effect|impact)|don.t know (what|how) ai"),
    ],
    "Limit what personal data AI systems can collect, and let users manage their data": [
        ("scraped without consent", r"consent|opt.out"),
        ("monitored at work", r"surveillance|monitor(ed|ing) (my|employees|workers)"),
        ("data sold to third parties", r"sold? (my|our|user) data|sell.*data|data broker"),
        ("children's data privacy", r"child.*data|kids?.*data"),
    ],
    "Pay workers who lose jobs due to AI while they find new jobs": [
        ("afraid of being laid off", r"layoff|laid off|job loss"),
        ("unemployment benefits and transition help", r"unemployment (benefit|insurance)|severance|transition assist"),
        ("universal basic income", r"basic income|guaranteed income|\bubi\b"),
    ],
    "Support AI training for workers": [
        ("community college and career pathways", r"community college"),
        ("employer-funded training", r"training program|workforce develop"),
        ("need AI education for adults", r"adult education|lifelong learning|reskilling for adults"),
    ],
    "Make sure privacy is protected": [
        ("companies collecting personal data", r"privacy|personal data"),
        ("data breaches and hacking", r"data breach|hack(ed|ing)|leaked (data|information)"),
    ],
    "Use AI to improve how government works": [
        ("government too slow to adapt", r"too slow|bureaucra|red tape"),
        ("AI cutting government costs", r"save (money|cost)|reduce (cost|spending)|(cost|budget).sav"),
        ("use AI in government services", r"government service|dmv|use ai in government|streamline government"),
        ("government adopting AI too fast", r"government.*(rush|too fast|hasty)|rushed (ai )?adoption"),
        ("AI making work more efficient overall", r"easier|more efficient|saves? (me )?time|speeds? up"),
        ("optimistic about AI's potential", r"excited about|optimistic|great potential|exciting"),
    ],
    "Keep humans in the loop as decision-makers, don't rely solely on AI": [
        ("keep a human in the loop", r"human in the loop|human oversight"),
        ("losing critical thinking skills", r"critical think"),
        ("chatbots replacing human contact", r"chatbot|talking to a bot"),
        ("loss of human judgment in decisions", r"human judg|no human review"),
        ("over-reliance on AI", r"over.reliance|too reliant|dependent on ai"),
        ("AI increasing workload, not reducing it", r"more work|added workload|extra work|increased workload"),
        ("general anxiety about AI", r"scary|scared|afraid of ai|fear(ful)? of ai|anxious|anxiety"),
        ("AI companionship replacing real relationships", r"ai (companion|girlfriend|boyfriend|friend)|replace human (connection|relationships)"),
    ],
    "Strengthen parental controls for AI use": [
        ("want parental controls for AI", r"parent(al)?|screen time"),
        ("worried about kids using AI", r"\bkid\b|\bkids\b|\bchild"),
    ],
    "Fund programs for human connection and life outside of AI": [
        ("social isolation and screen time", r"social isolat|human connection|screen addict|lonel"),
        ("AI therapy and mental health concerns", r"therap(y|ist)|mental health.*ai|ai.*(therapy|counsel)"),
        ("AI dependence/overuse", r"addict(ed|ion)? to ai|can.t (live|function) without"),
    ],
    "Make sure students don't use AI to avoid learning": [
        ("students using AI to cheat", r"cheat|plagiar|homework|essay"),
        ("losing critical thinking skills", r"critical think"),
    ],
    "Keep companies from firing or punishing workers for not using AI": [
        ("penalized for not using AI", r"fired for not using|forced to use ai|mandat.*use ai"),
    ],
    "Track and report on job loss due to AI": [
        ("afraid of being laid off", r"layoff|laid off|job loss"),
        ("entry-level jobs disappearing", r"entry.level|new grad|internship"),
    ],
    "Use AI for jobs people don’t want to do or can’t do": [
        ("dangerous or dirty jobs", r"dangerous job|dirty job|jobs (people|nobody) don.t want|repetitive task"),
        ("AI helping accessibility for disabilities", r"disab(led|ility)|accessib(le|ility)"),
    ],
}

# ── 3. Assemble output ──────────────────────────────────────────────────────

subthemes_js = []
for st in subtheme_order:
    short, theme_i, color = SUBTHEME_META[st]
    subthemes_js.append(
        f'  {{ shortName:{short!r}, fullName:{st!r}, theme:{theme_i}, color:{color!r} }}'
    )

concepts_js = []
for r in rows:
    label = r["Policy concept"]
    st_i = subtheme_index[r["Subtheme"]]
    w = float(r[COMPOSITE_COL])
    sessions = int(r["Sessions"])
    sessions_pct = r["Sessions %"]
    votes = int(r["Votes"])
    ideas = int(r["Ideas"])

    children = CHILDREN.get(label)
    assert children, f"no placeholder children authored for: {label!r}"
    from_list = []
    for child_label, pattern in children:
        n = kw_count(pattern)
        assert n > 0, f"zero-weight child (dead regex?): {child_label!r} <- {pattern!r}"
        from_list.append(f"[{child_label!r}, {n}]")

    concepts_js.append(
        "  { label:%r, subtheme:%d, w:%s, sessions:%d, sessionsPct:%r, "
        "votes:%d, ideas:%d, from:[%s] }"
        % (label, st_i, w, sessions, sessions_pct, votes, ideas, ", ".join(from_list))
    )

print(f"// {len(subtheme_order)} subthemes, {len(rows)} concepts, "
      f"{sum(len(v) for v in CHILDREN.values())} placeholder Phase 1 children")
print("const THEMES = " + repr(THEMES) + ";\n")
print("const SUBTHEMES = [\n" + ",\n".join(subthemes_js) + "\n];\n")
print("const CONCEPTS = [\n" + ",\n".join(concepts_js) + "\n];")
