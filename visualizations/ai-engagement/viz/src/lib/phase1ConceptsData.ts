/**
 * Placeholder Phase 1 concept taxonomy, ported verbatim from
 * sketches/concept-distillation-real-phase2-themes.html (THEMES/SUBTHEMES/
 * CONCEPTS) — see that file's own header comment for provenance. No real
 * Phase 1 codebook exists yet: these 27 concepts and their 126 children are
 * invented labels, but each child's weight is real — the number of the
 * 2,514 Phase 1 open-text respondents whose answers matched a keyword for
 * that phrase (analysis/scripts/phase1_keyword_counts.py). Swap this module out
 * wholesale once a real Phase 1 codebook exists; nothing else in this file
 * should survive that swap unchanged.
 */

export interface Phase1Theme {
  label: string;
}

export interface Phase1Subtheme {
  shortName: string;
  fullName: string;
  theme: number;
}

export interface Phase1ConceptChild {
  label: string;
  count: number;
}

export interface Phase1Concept {
  label: string;
  subtheme: number;
  w: number;
  sessions: number;
  sessionsPct: string;
  votes: number;
  ideas: number;
  from: Phase1ConceptChild[];
}

export const PHASE1_THEMES: Phase1Theme[] = [
  { label: 'Making rules for AI companies' },
  { label: 'Protecting our way of life' },
  { label: 'Learning about and adapting to AI' },
];

export const PHASE1_SUBTHEMES: Phase1Subtheme[] = [
  { shortName: 'People & nature', fullName: 'Protecting people and nature from the effects of AI', theme: 0 },
  { shortName: 'How & where AI is used', fullName: 'Regulating how AI works and where it’s used', theme: 0 },
  { shortName: 'Jobs & workers', fullName: 'Protecting jobs and workers', theme: 1 },
  { shortName: 'Public\'s say', fullName: 'Making sure the public has their say on AI impacts that affect them', theme: 1 },
  { shortName: 'Personal data', fullName: 'Empowering people to protect their data', theme: 1 },
  { shortName: 'Human choice', fullName: 'Preserving the rights of humans to choose and decide', theme: 1 },
  { shortName: 'Research & literacy', fullName: 'Increasing AI research and literacy', theme: 2 },
  { shortName: 'Kids & education', fullName: 'Protecting kids and education', theme: 1 },
];

export const PHASE1_CONCEPTS: Phase1Concept[] = [
  {
    label: 'Hold AI companies liable for harm they cause',
    subtheme: 0,
    w: 0.904,
    sessions: 7,
    sessionsPct: '50%',
    votes: 44,
    ideas: 12,
    from: [
      { label: 'who\'s liable when AI causes harm', count: 170 },
      { label: 'AI bias causing real harm', count: 54 },
      { label: 'no clear recourse when AI causes harm', count: 12 },
      { label: 'AI making medical decisions', count: 4 },
      { label: 'AI replacing radiologists and doctors', count: 16 },
      { label: 'AI in insurance decisions', count: 5 },
      { label: 'rising healthcare costs tied to AI', count: 2 },
      { label: 'distrust of AI companies', count: 39 },
    ],
  },
  {
    label: 'Protect people and nature from the resource needs of data centers',
    subtheme: 0,
    w: 0.8465,
    sessions: 6,
    sessionsPct: '43%',
    votes: 39,
    ideas: 9,
    from: [
      { label: 'data centers near homes', count: 419 },
      { label: 'cooling water demand', count: 270 },
      { label: 'electricity costs and grid strain', count: 83 },
      { label: 'renewable energy tradeoffs', count: 20 },
      { label: 'noise and falling property values', count: 26 },
      { label: 'drought tradeoffs', count: 11 },
      { label: 'AI\'s carbon footprint', count: 7 },
      { label: 'local approval fights over new sites', count: 2 },
      { label: 'data centers owned out of state', count: 3 },
    ],
  },
  {
    label: 'Set rules for where AI can be used safely',
    subtheme: 1,
    w: 0.846,
    sessions: 7,
    sessionsPct: '50%',
    votes: 36,
    ideas: 10,
    from: [
      { label: 'AI screening job applicants', count: 181 },
      { label: 'AI making high-stakes decisions unfairly', count: 54 },
      { label: 'scams and fraud using AI', count: 61 },
      { label: 'AI in elections and misinformation', count: 7 },
      { label: 'military and weapons use of AI', count: 22 },
      { label: 'self-driving vehicles and safety', count: 7 },
      { label: 'AI replacing lawyers and legal work', count: 21 },
    ],
  },
  {
    label: 'Set rules around how AI works',
    subtheme: 1,
    w: 0.712,
    sessions: 8,
    sessionsPct: '57%',
    votes: 23,
    ideas: 8,
    from: [
      { label: 'companies won\'t explain how AI decides', count: 82 },
      { label: 'no way to audit the algorithms', count: 19 },
      { label: 'AI is a black box', count: 6 },
      { label: 'AI gives wrong or made-up answers', count: 59 },
      { label: 'AI moving too fast to regulate safely', count: 1 },
      { label: 'ban or pause AI development', count: 31 },
      { label: 'need safety testing before release', count: 1 },
    ],
  },
  {
    label: 'Deter layoffs because of AI, reward firms that keep or add workers',
    subtheme: 2,
    w: 0.7115,
    sessions: 6,
    sessionsPct: '43%',
    votes: 34,
    ideas: 8,
    from: [
      { label: 'afraid of being laid off', count: 398 },
      { label: 'small businesses keeping staff', count: 36 },
      { label: 'white-collar jobs at risk too', count: 57 },
      { label: 'customer service jobs cut', count: 66 },
      { label: 'creative jobs replaced by AI', count: 37 },
      { label: 'middle-class jobs squeezed', count: 44 },
      { label: 'programmers and coders losing work', count: 53 },
      { label: 'automation replacing routine work broadly', count: 215 },
      { label: 'productivity gains from AI', count: 276 },
      { label: 'inflation and cost of living', count: 36 },
      { label: 'farm and agricultural jobs affected', count: 29 },
      { label: 'truck driving and transportation jobs', count: 2 },
      { label: 'AI creating new kinds of jobs', count: 17 },
    ],
  },
  {
    label: 'Make AI policymaking more open to the public',
    subtheme: 3,
    w: 0.7115,
    sessions: 6,
    sessionsPct: '43%',
    votes: 27,
    ideas: 8,
    from: [
      { label: 'want a real say in AI policy', count: 130 },
      { label: 'AI industry writing its own rules', count: 12 },
      { label: 'other countries moving faster on AI', count: 28 },
      { label: 'distrust of AI companies', count: 39 },
      { label: 'federal vs. state authority over AI', count: 4 },
      { label: 'create a dedicated AI oversight agency', count: 5 },
    ],
  },
  {
    label: 'Make companies follow rules and be open about how they handle personal data',
    subtheme: 4,
    w: 0.7115,
    sessions: 5,
    sessionsPct: '36%',
    votes: 38,
    ideas: 11,
    from: [
      { label: 'companies collecting personal data', count: 109 },
      { label: 'monitored at work', count: 43 },
      { label: 'data breaches and hacking', count: 6 },
      { label: 'data sold to third parties', count: 14 },
      { label: 'facial recognition and biometric tracking', count: 3 },
    ],
  },
  {
    label: 'Make companies reskill or give career help to workers who lose their jobs to AI',
    subtheme: 2,
    w: 0.7115,
    sessions: 5,
    sessionsPct: '36%',
    votes: 20,
    ideas: 5,
    from: [
      { label: 'need retraining programs', count: 136 },
      { label: 'employer-funded training', count: 47 },
      { label: 'community college and career pathways', count: 12 },
      { label: 'gig work as a fallback', count: 31 },
    ],
  },
  {
    label: 'Set rules for labeling when AI is used',
    subtheme: 5,
    w: 0.654,
    sessions: 7,
    sessionsPct: '50%',
    votes: 30,
    ideas: 9,
    from: [
      { label: 'want AI content labeled', count: 65 },
      { label: 'can\'t tell what\'s AI-generated', count: 61 },
      { label: 'deepfakes of real people', count: 14 },
      { label: 'voice cloning used in scams', count: 7 },
    ],
  },
  {
    label: 'Restrict and tax AI companies’ profits',
    subtheme: 1,
    w: 0.5195,
    sessions: 5,
    sessionsPct: '36%',
    votes: 18,
    ideas: 6,
    from: [
      { label: 'profits going to shareholders', count: 269 },
      { label: 'small businesses can\'t compete', count: 36 },
      { label: 'big tech has too much power', count: 80 },
      { label: 'robot tax proposals', count: 4 },
      { label: 'tax AI companies to fund social programs', count: 59 },
      { label: 'AI widening the gap between rich and poor', count: 11 },
    ],
  },
  {
    label: 'Hold AI companies liable if they use the work of others without permission',
    subtheme: 1,
    w: 0.5575,
    sessions: 4,
    sessionsPct: '29%',
    votes: 20,
    ideas: 5,
    from: [
      { label: 'artists uncompensated for their work', count: 231 },
      { label: 'scraped without consent', count: 68 },
      { label: 'musicians and authors uncompensated', count: 21 },
      { label: 'AI replacing artists in games and film', count: 32 },
      { label: 'AI trained on copyrighted work specifically', count: 3 },
      { label: 'protect journalism from AI', count: 6 },
    ],
  },
  {
    label: 'Make people aware of how to use AI ethically',
    subtheme: 6,
    w: 0.481,
    sessions: 8,
    sessionsPct: '57%',
    votes: 22,
    ideas: 8,
    from: [
      { label: 'teach ethical AI use', count: 89 },
      { label: 'need AI literacy programs', count: 18 },
      { label: 'need public AI literacy campaigns', count: 2 },
      { label: 'digital divide and rural access', count: 1 },
      { label: 'AI translation and language access', count: 12 },
    ],
  },
  {
    label: 'Improve AI education in schools',
    subtheme: 7,
    w: 0.4425,
    sessions: 4,
    sessionsPct: '29%',
    votes: 14,
    ideas: 4,
    from: [
      { label: 'AI in the classroom', count: 232 },
      { label: 'students using AI to cheat', count: 48 },
      { label: 'teachers replaced or assisted by AI', count: 9 },
      { label: 'AI in college admissions', count: 1 },
    ],
  },
  {
    label: 'Allow people to opt out of AI and make that easier',
    subtheme: 4,
    w: 0.423,
    sessions: 5,
    sessionsPct: '36%',
    votes: 18,
    ideas: 6,
    from: [
      { label: 'hard to opt out of AI', count: 26 },
      { label: 'forced to use AI with no choice', count: 11 },
    ],
  },
  {
    label: 'Support independent research on AI\'s effects',
    subtheme: 6,
    w: 0.3845,
    sessions: 2,
    sessionsPct: '14%',
    votes: 15,
    ideas: 4,
    from: [
      { label: 'fund independent research on AI risks', count: 14 },
      { label: 'unknown long-term effects', count: 18 },
    ],
  },
  {
    label: 'Limit what personal data AI systems can collect, and let users manage their data',
    subtheme: 4,
    w: 0.3465,
    sessions: 3,
    sessionsPct: '21%',
    votes: 13,
    ideas: 4,
    from: [
      { label: 'scraped without consent', count: 68 },
      { label: 'monitored at work', count: 43 },
      { label: 'data sold to third parties', count: 14 },
      { label: 'children\'s data privacy', count: 19 },
    ],
  },
  {
    label: 'Pay workers who lose jobs due to AI while they find new jobs',
    subtheme: 2,
    w: 0.2695,
    sessions: 2,
    sessionsPct: '14%',
    votes: 9,
    ideas: 2,
    from: [
      { label: 'afraid of being laid off', count: 398 },
      { label: 'unemployment benefits and transition help', count: 41 },
      { label: 'universal basic income', count: 156 },
    ],
  },
  {
    label: 'Support AI training for workers',
    subtheme: 6,
    w: 0.346,
    sessions: 4,
    sessionsPct: '29%',
    votes: 11,
    ideas: 4,
    from: [
      { label: 'community college and career pathways', count: 12 },
      { label: 'employer-funded training', count: 47 },
      { label: 'need AI education for adults', count: 3 },
    ],
  },
  {
    label: 'Make sure privacy is protected',
    subtheme: 4,
    w: 0.25,
    sessions: 3,
    sessionsPct: '21%',
    votes: 25,
    ideas: 6,
    from: [
      { label: 'companies collecting personal data', count: 109 },
      { label: 'data breaches and hacking', count: 6 },
    ],
  },
  {
    label: 'Use AI to improve how government works',
    subtheme: 1,
    w: 0.25,
    sessions: 3,
    sessionsPct: '21%',
    votes: 15,
    ideas: 4,
    from: [
      { label: 'government too slow to adapt', count: 15 },
      { label: 'AI cutting government costs', count: 45 },
      { label: 'use AI in government services', count: 7 },
      { label: 'government adopting AI too fast', count: 7 },
      { label: 'AI making work more efficient overall', count: 238 },
      { label: 'optimistic about AI\'s potential', count: 12 },
    ],
  },
  {
    label: 'Keep humans in the loop as decision-makers, don\'t rely solely on AI',
    subtheme: 5,
    w: 0.2115,
    sessions: 4,
    sessionsPct: '29%',
    votes: 12,
    ideas: 4,
    from: [
      { label: 'keep a human in the loop', count: 23 },
      { label: 'losing critical thinking skills', count: 66 },
      { label: 'chatbots replacing human contact', count: 30 },
      { label: 'loss of human judgment in decisions', count: 15 },
      { label: 'over-reliance on AI', count: 16 },
      { label: 'AI increasing workload, not reducing it', count: 48 },
      { label: 'general anxiety about AI', count: 45 },
      { label: 'AI companionship replacing real relationships', count: 1 },
    ],
  },
  {
    label: 'Strengthen parental controls for AI use',
    subtheme: 7,
    w: 0.173,
    sessions: 2,
    sessionsPct: '14%',
    votes: 8,
    ideas: 2,
    from: [
      { label: 'want parental controls for AI', count: 42 },
      { label: 'worried about kids using AI', count: 86 },
    ],
  },
  {
    label: 'Fund programs for human connection and life outside of AI',
    subtheme: 5,
    w: 0.1155,
    sessions: 3,
    sessionsPct: '21%',
    votes: 7,
    ideas: 4,
    from: [
      { label: 'social isolation and screen time', count: 9 },
      { label: 'AI therapy and mental health concerns', count: 38 },
      { label: 'AI dependence/overuse', count: 1 },
    ],
  },
  {
    label: 'Make sure students don\'t use AI to avoid learning',
    subtheme: 7,
    w: 0.1155,
    sessions: 3,
    sessionsPct: '21%',
    votes: 9,
    ideas: 3,
    from: [
      { label: 'students using AI to cheat', count: 48 },
      { label: 'losing critical thinking skills', count: 66 },
    ],
  },
  {
    label: 'Keep companies from firing or punishing workers for not using AI',
    subtheme: 2,
    w: 0.0385,
    sessions: 2,
    sessionsPct: '14%',
    votes: 6,
    ideas: 2,
    from: [
      { label: 'penalized for not using AI', count: 16 },
    ],
  },
  {
    label: 'Track and report on job loss due to AI',
    subtheme: 2,
    w: 0,
    sessions: 1,
    sessionsPct: '7%',
    votes: 3,
    ideas: 1,
    from: [
      { label: 'afraid of being laid off', count: 398 },
      { label: 'entry-level jobs disappearing', count: 184 },
    ],
  },
  {
    label: 'Use AI for jobs people don’t want to do or can’t do',
    subtheme: 2,
    w: 0,
    sessions: 1,
    sessionsPct: '7%',
    votes: 2,
    ideas: 1,
    from: [
      { label: 'dangerous or dirty jobs', count: 20 },
      { label: 'AI helping accessibility for disabilities', count: 48 },
    ],
  },
];
