import type { EvidenceWorkspace } from "@basquio/types";

export type DomainKnowledgeStage =
  | "analyst"
  | "storyline"
  | "author"
  | "critic"
  | "strategic-critic";

export type DomainKnowledgePackId = "niq-storymasters-fmcg";

type DomainKnowledgeMatch = {
  packId: DomainKnowledgePackId;
  score: number;
  activated: boolean;
  matchedBriefCues: string[];
  matchedDataCues: string[];
  matchedNegativeCues: string[];
};

// Brief cues: must be FMCG-specific terms, not generic business words
const FMCG_POSITIVE_CUES = [
  "fmcg",
  "cpg",
  "consumer packaged goods",
  "grocery",
  "shopper",
  "trade marketing",
  "category management",
  "category review",
  "brand analysis",
  "market share",
  "distribution",
  "velocity",
  "rotation",
  "promo",
  "promotion",
  "sku",
  "upc",
  "pos",
  "rms",
  "assortment",
  "shelf",
  "sell-in",
  "sell out",
  "buyer",
  "household",
  "brand mix",
  "petfood",
  "pet care",
  "food",
  "beverage",
  "personal care",
  "home care",
  "confectionery",
  "snack",
  "dairy",
  "frozen",
];

// Data cues: column/sheet names that strongly indicate FMCG retail data
// Removed generic terms (brand, sales, value, market) that appear in ANY business dataset
const FMCG_DATA_CUES = [
  "marca",
  "fornitore",
  "comparto",
  "famiglia",
  "mercato_ecr",
  "area_ecr",
  "confezioni",
  "valore",
  "quota",          // Italian for "share"
  "distr",          // matches "distribuzione", "distr. pond.", etc.
  "rotazioni",
  "promo",
  "baseline",
  "sku",
  "upc",
  "ean",
  "pet care",
  "nielseniq",
  "niq",
  "iri",
  "circana",
  "kantar",
  "shopper",
  "panel",
  "velocity",
  "penetration",
];

const FMCG_NEGATIVE_CUES = [
  "stock market",
  "equity research",
  "capital markets",
  "fundraising",
  "business plan",
  "startup financial model",
  "saas roadmap",
  "engineering planning",
  "product requirements",
  "crypto",
  "portfolio optimization",
];

function normalize(value: string) {
  return value.toLowerCase();
}

function collectCueMatches(haystack: string, cues: string[]) {
  const normalized = normalize(haystack);
  return cues.filter((cue) => normalized.includes(cue));
}

function collectWorkspaceText(workspace: EvidenceWorkspace) {
  const inventory = (workspace.fileInventory ?? []).flatMap((file) => {
    if (!file) return [];
    const sheetBits = (file.sheets ?? []).flatMap((sheet) => {
      if (!sheet) return [];
      return [
        sheet.name,
        ...(sheet.columns ?? []).map((column) => column?.name).filter(Boolean),
      ];
    });

    return [
      file.fileName,
      file.kind,
      file.role,
      file.mediaType,
      ...(file.warnings ?? []),
      ...sheetBits,
    ];
  });

  return inventory.filter(Boolean).join(" ");
}

export function scoreDomainKnowledgePacks(args: {
  workspace?: EvidenceWorkspace;
  brief: string;
}): DomainKnowledgeMatch[] {
  const workspaceText = args.workspace ? collectWorkspaceText(args.workspace) : "";
  const briefMatches = collectCueMatches(args.brief, FMCG_POSITIVE_CUES);
  const dataMatches = collectCueMatches(workspaceText, FMCG_DATA_CUES);
  const negativeMatches = collectCueMatches(`${args.brief} ${workspaceText}`, FMCG_NEGATIVE_CUES);

  const score = briefMatches.length * 2 + dataMatches.length - negativeMatches.length * 5;
  const activated =
    negativeMatches.length === 0 &&
    ((briefMatches.length >= 1 && dataMatches.length >= 1) ||
      briefMatches.length >= 2 ||
      dataMatches.length >= 3);

  return [{
    packId: "niq-storymasters-fmcg",
    score,
    activated,
    matchedBriefCues: briefMatches,
    matchedDataCues: dataMatches,
    matchedNegativeCues: negativeMatches,
  }];
}

const STAGE_PAYLOADS: Record<DomainKnowledgeStage, string> = {
  analyst: `## FMCG/CPG ANALYST INTELLIGENCE (NIQ StoryMasters)

### MANDATORY FIRST STEPS (before any analysis)
1. List all files and sheets to understand the data landscape
2. Sample rows from the main data sheet to see column names and values
3. IMMEDIATELY compute ALL applicable derivatives using compute_derived:
   - If CY + PY columns exist: compute growth_rate for each
   - If brand + total columns exist: compute share for each brand
   - If value + units columns exist: compute per_unit price
   - If value + volume columns exist: compute per_unit price
   - If brand prices exist: compute index vs category average
   Do NOT skip this step. These derivatives are the foundation of every finding.

Frame the work around the TRUE COMMERCIAL QUESTION, not a generic summary.
Classify every finding as: connection (confirms hypothesis), contradiction (challenges assumptions), or curiosity (unexpected signal).

### Core 20 KPIs — Know These By Name
| Italian Alias | English Name | Key | Formula |
|---|---|---|---|
| V. Valore | Sales Value | sales_value | base fact |
| V. Confezioni | Sales Units | sales_units | base fact |
| Var.% V. Valore Anno prec. | Value Growth YoY | value_growth_yoy_pct | (CY/PY-1)×100 |
| Quota Val. - Product | Value Share | value_share_pct | Brand/Total×100 |
| Var.Ass. Quota Val. | Share Change | share_change_pts | Share CY - Share PY |
| Prezzo Medio Conf. | Avg Price per Pack | avg_price_pack | Value/Units |
| Price Index - Product | Price Index vs Ref | price_index | (Brand/Ref)×100 |
| Distr. Pond. | Weighted Distribution | weighted_dist_pct | weighted by store importance |
| Rotazioni Valore per PDV | Value ROS per Store | ros_value_weekly | (Value/Stores)/Weeks |
| Any Promo Int.Idx Val. | Promo Intensity | promo_intensity_pct | Promo/Total×100 (>50% = danger) |

### Derivative Computations (MUST compute when base facts exist)
1. Value Growth % = (CY/PY - 1) × 100
2. Value Share = Brand Value / Category Value × 100
3. Share Change pts = Share CY - Share PY
4. Average Price = Value / Volume or Units
5. Mix % = Segment Value / Total × 100
6. Mix Gap pp = Brand Mix% - Category Mix% (over/under-indexed?)
7. Price Index = (Brand Price / Cat Price) × 100
8. Concentration CR4 = Sum of top 4 shares

### Diagnostic Motifs (Pattern → Story Angle)
| Pattern | Signals | Chart |
|---|---|---|
| Availability Problem | Low dist, reasonable ROS | scatter (dist vs velocity) |
| Velocity Problem | Good dist, weak ROS | horizontal_bar (ROS ranked) |
| Price/Mix Tension | Value growth > volume growth | grouped_bar (value vs vol growth) |
| Promo Dependence | Intensity >50%, weak baseline | stacked_bar (baseline vs incremental) |
| Portfolio Mismatch | Mix gap > ±5pp | stacked_bar_100 (cat vs brand mix) |
| Hero Concentration | Top 3 SKUs >50% of value | pareto + horizontal_bar |
| Share Erosion | Declining share, stable category | grouped_bar (share CY vs PY) |

### FMCG Action Levers
share, distribution, rotation, promotion, pack/format, retailer, channel, buyer, loyalty.
Do NOT hardcode currency symbols — infer from data.

### Consumer Panel (CPS) KPIs — When Shopper Data Present
| KPI | Key | Formula |
|---|---|---|
| Penetration | penetration_pct | % households buying in period |
| Frequency | purchase_frequency | occasions per buyer per period |
| Basket Size | basket_size | spend or units per occasion |
| Loyalty (SoR) | share_of_requirements | % category spend on brand |
| Trial | trial_buyers | first-time buyers in period |
| Repeat Rate | repeat_rate_pct | repeat buyers / trial buyers |

Dupont decomposition: Value = Penetration * Frequency * Basket * Price
Use to explain WHY value changed (fewer buyers? less often? smaller baskets?).

### Price & Promo Modeling — When Promo/Pricing Data Present
- Baseline Sales: modeled sales without any promotion
- Incremental Sales: additional volume from promo activity
- Promo Lift: incremental / baseline (diminishing returns above 2x)
- TPR Depth Bands: 10-20% (light), 20-30% (moderate), 30-40% (aggressive), >40% (margin destruction)
- Price Elasticity: % volume change / % price change (>|1| = elastic, respond to promo)
- EDLP: regular price IS the competitive price (Discount channel strategy)

### Innovation / Launch — When New Product Data Present
- Trial Volume: projected first-year buyers
- Repeat Rate: % of triers who repurchase
- Incrementality: % of launch volume NEW to category (vs. cannibalization)
- Source of Volume: from competitor, from adjacent category, or new occasions

### Client Need Routing — Match Question to Right Analysis
| Client Question | Primary Analysis | Key Metrics |
|---|---|---|
| How is my category performing? | RMS tracking | Value, Volume, Share, Growth |
| Who is buying my brand? | CPS panel | Penetration, Frequency, Loyalty |
| Why are sales declining? | RMS + Price & Promo | Baseline vs Incremental, Distribution |
| Where should I distribute? | RMS void analysis | Wtd. Distribution gap, ACV |
| Is my promo working? | Price & Promo model | Lift, Elasticity, Baseline trend |
| Should I launch this product? | Innovation/BASES | Trial, Repeat, Incrementality |
| How do I grow in Discount? | RMS channel + CPS | Channel share, Price Index, EDLP fit |`,

  storyline: `## NIQ STORYMASTERS STORYLINE FRAMEWORK

### SCQA Structure (Mandatory for Exec Summary)
- Situation: What the client already knows (with numbers, specific)
- Complication: The tension (with numbers, why it matters NOW)
- Question: The strategic issue to solve (rooted in growth opportunity)
- Answer: Quantified, actionable recommendation (NOT a generic observation)

Quality rules: S & C must be specific (not generic). Only ONE answer per SCQA. Answer must be quantified and implementable.
Bad: "Decline is due to distribution loss"
Good: "Gaining back z% of buyers at Retailer A through bigger pack launch would boost sales by x%"

SCQA is the wrapper, not the analytical engine. For NielsenIQ promo work, the body of the deck must still drill down mechanically across market, channel, retailer/area, format, competitor, promo mechanic, and productivity.

### Pyramid Principle (Barbara Minto)
Level 1: ANSWER (exec summary title) → Level 2: 3-4 POVs → Level 3: Evidence slides (chart-led)

### Long-Deck Depth Rule (MECE issue tree)
- Decks above 20 slides must be planned as an issue tree: root question -> chapter branches -> unique leaf questions.
- Each leaf question becomes exactly one slide.
- Two slides may not answer the same leaf question with different visuals.
- Long decks deepen by drilling into segment, channel, format, brand, SKU, retailer, price, promo, distribution, geography, shopper, or scenario cuts.
- Good progression: category -> segment -> channel/brand -> SKU/driver -> recommendation.
- Bad progression: same finding repeated as bar, line, and table.

### DEDUCTIVE is DEFAULT for Basquio
Answer comes FIRST (slide 2), then Reasons, then Data evidence.
Only use INDUCTIVE if brief explicitly says "walk me through the analysis."

### Every Section Must Ladder: What → So What → Now What
- Distill findings into 3-4 POVs, not a pile of facts
- Recommendations prioritized by: Prize × Feasibility × Ease × Time × Fit
- FMCG levers: distribution expansion, pricing/pack architecture, promo optimization, portfolio rebalancing, hero renovation, tail pruning
- For decks above 40 slides, each chapter should reach at least L3 depth before recommending action.
- For promo briefs, use the cascade: category baseline -> value vs volume vs price -> promo vs no-promo -> discount tiers -> localization -> focal brand vs competitor -> WD Promo/display/folder -> short synthesis.
- Keep analytical branches contiguous. Do not jump from segments to channels and then back to segments unless the revisit is explicit synthesis/comparison or a clearly deeper follow-up.

### Exhibit Selection Rules (for chart planning — ABSOLUTE, no exceptions)
| Question | CORRECT Chart | FORBIDDEN |
|---|---|---|
| How big is each segment? | horizontal_bar (ranked) | pie (>5), line |
| How does mix compare? | stacked_bar_100 | separate pies, line |
| CY vs PY (2 periods)? | grouped_bar / waterfall | line, area |
| What's growing/declining? | horizontal_bar (diverging) | table, line |
| Who dominates? | doughnut / pareto | scatter |
| Top N items? | horizontal_bar (humanized) | table with codes |
| What changed and why? | waterfall bridge | stacked bar |
| Trend over time (4+)? | line | bar |

### Anti-Patterns (MUST NEVER plan these)
- Line chart for categorical/unordered comparisons
- Line chart for 2-period CY/PY data
- Memo slides when a chart proves the point — ALWAYS plan a chart
- More than 1 text-only analytical slide per deck
- Every analytical slide (positions 3 through N-1) MUST have a chartId`,

  author: `## NIQ STORYMASTERS SLIDE AUTHORING

### Slide Structure: What → So What → Now What
- Title IS the insight (not a topic label). Bad: "Category Overview". Good: "Cat wet is the largest pool at €781M but brand has near-zero presence"
- Chart IS the hero (60%+ of slide area). Max 2-3 supporting bullets.
- Body explains WHY, not WHAT. The chart shows WHAT.
- Client-friendly copy is allowed only after the slide passes intelligence non-negotiables. Friendliness never overrides evidence depth.

### Exhibit Selection Rules (ABSOLUTE — No Exceptions)
| Question | CORRECT Chart | FORBIDDEN |
|---|---|---|
| How big is each segment? | horizontal_bar (ranked) | pie (>5), line |
| How does mix compare? | stacked_bar_100 | separate pies, line |
| CY vs PY (2 periods)? | grouped_bar / waterfall | line, area |
| What's growing/declining? | horizontal_bar (diverging) | table, line |
| Who dominates? | doughnut / pareto | scatter |
| Top N items? | horizontal_bar (humanized) | table with codes |
| What changed and why? | waterfall bridge | stacked bar |
| Trend over time (4+)? | line | bar |
| Distribution vs velocity? | scatter | line |
| Unordered categories? | bar | NEVER line or area |

### Anti-Patterns (MUST NEVER happen)
- Line chart for categorical/unordered comparisons
- Line chart for 2-period CY/PY data
- Raw SKU codes (P-008294-001) as labels — use product names
- Memo slides when a chart proves the point
- Share without specifying the denominator
- More than 1 text-only slide per deck
- Never hardcode currency symbols — infer from data
- Never invent a growth target or strategic objective not present in the brief or directly derivable from evidence
- Never chart sales value when the slide claim is a rotation or productivity problem
- Never state a distribution opportunity without rotation, ROS, or productivity proof
- Never let the focal brand disappear from a competitor / supplier slide
- Never hop across analytical branches in a way that breaks the storyline; finish one branch before switching unless the later revisit is explicit synthesis/comparison or a deeper follow-up

### KPI Label Translation (Italian → English)
V. Valore → Sales Value, V. Confezioni → Units, Quota Val. → Value Share,
Var.Ass. Quota → Share Change, Distr. Pond. → Wtd. Distribution,
Rotazioni → Velocity/ROS, Prezzo Medio → Avg Price, Any Promo Int. → Promo Intensity

### Quantify All Recommendations Using FMCG Levers
Distribution expansion, pricing/pack, promo optimization, portfolio rebalancing, hero renovation, tail pruning.

### Long-Deck Depth Rules
- Decks above 40 slides must cover multiple drill-down dimensions, not more chart types of the same cut.
- A recommendation is only credible after the deck reaches at least two evidence levels below the topline claim.
- Use explicit cascades such as segment -> channel -> SKU/driver, or brand -> format -> retailer.
- Avoid redundant broadening: if two planned slides can be reconstructed from the same data cut, collapse them and go deeper instead.

### COPYWRITING VOICE (HARD RULES)

#### BANNED (instant quality failure)
- Em dashes anywhere. Use commas, periods, or colons.
- "This isn't X, this is Y" staccato pattern
- "Let's dive/explore..." / "It's worth noting" / "Moving forward" / "In today's landscape"
- "Leveraging" / "synergies" / "holistic" / "robust" / "innovative" / "scalable" / "streamline" / "unlock" / "empower"
- Rhetorical questions as transitions ("So what does this mean?")
- Gerund-starting bullets ("Driving...", "Optimizing...")
- "Interestingly," / "Notably," / "Importantly," sycophantic openers
- Exclamation marks in analytical text
- Hedging: "may potentially" / "it appears that" / "it should be noted"
- Overconfidence without evidence: "clearly" / "obviously" / "undoubtedly"
- Long words when short ones work: "utilize" → "use", "demonstrate" → "show", "remediate" → "fix"

#### REQUIRED VOICE
- Numbers first, interpretation second. "Share fell 2.1pp" not "we observed a decline"
- Active voice. "Affinity lost share" not "share was lost by Affinity"
- Opinionated when data supports it. "This is a pricing problem, not a demand problem."
- Every sentence carries information. Zero filler. Zero padding.
- Short words. Direct tone. Consulting grade. Like a McKinsey partner talking, not a press release.
- Growth always shows sign: "+12.4%" or "-3.2%"
- Share specifies denominator: "18.3% of Total Tracked Market"

#### ITALIAN VOICE (when deck is in Italian)
- Sharp professional Italian. Not translated-from-English. Not bureaucratic.
- English business terms OK when standard: brand, market share, retail, B2B, KPI, SKU, CAGR
- Use Italian where natural: "distribuzione" not "distribution", "quota" not "share", "crescita" not "growth"
- No AI Italian: "Questo rappresenta un'opportunità" is bad. "C'è spazio per crescere" is good.
- Conversational register: "I freschi crescono ma pesano poco" not "Il segmento dei prodotti freschi evidenzia un trend di crescita"
- Short sentences. 15 words average, 25 max.

#### FORMATTING
- Thousands separator per locale (1,234 EN / 1.234 IT)
- "€24.7M" not "24.7 M EUR". Symbol before, no space.
- "2.1pp" or "2.1 punti" not "2.1 percentage points"
- Periods: L52W, MAT, Q1'25. Comparisons: vs. PY, vs. L52W

### NIQ PRODUCT PORTFOLIO (for context-aware analysis)
- RMS (Retail Measurement Services): store-level sales, share, distribution, price, velocity
- CPS (Consumer Panel): household penetration, frequency, basket, loyalty, trial/repeat
- Price & Promo Modeling: baseline/incremental, elasticity, scenario simulation
- Innovation/BASES: trial volume, repeat rate, incrementality, source of volume
- Voice of Client routing: "Am I losing share?" → RMS share + CPS loyalty; "Where should I launch?" → CPS whitespace + RMS distribution`,

  critic: `## NIQ FACTUAL REVIEW CHECKLIST

### Chart-Question Matching (Flag Violations)
- Line chart used for categorical/unordered data? → CRITICAL
- Line chart used for 2-period CY/PY comparison? → CRITICAL
- Pie chart with >5 segments? → MAJOR
- No chart on a slide where data could prove the point? → MAJOR
- Raw Italian column headers as chart labels? → MAJOR
- Share metric without denominator specified? → MAJOR

### Content Quality Checks
- Does the title state an insight or just a topic label? → Flag topic labels
- Are findings confused with recommendations? (findings = what happened; recs = what to do)
- Are raw SKU codes shown instead of product names?
- Is currency hardcoded instead of inferred from data?
- Are KPIs named correctly? (V. Valore should display as "Sales Value", not raw header)

### Recommendation Logic
- Is each recommendation tied to a specific FMCG lever? (share, distribution, rotation, promotion, pack, retailer, channel)
- Is the recommendation quantified? ("expand distribution" is bad; "gain 5pp distribution in top 3 retailers" is good)
- Does the recommendation flow from the evidence shown?

### Structural Checks
- SCQA present in exec summary?
- Max 1 text-only slide?
- Cover title = the Answer (not a topic)?`,

  "strategic-critic": `## NIQ STORYMASTERS NARRATIVE REVIEW

### Story Architecture
- Does the deck ask the TRUE commercial question? (not "what happened" but "what should we do")
- Is the structure DEDUCTIVE? (answer on slide 2, then proof) — flag if answer is buried at the end
- Are 3-4 POVs clearly separated from descriptive evidence?
- Does the title read-through tell the complete SCQA story?

### Synthesis Quality
- Do POVs SYNTHESIZE evidence or just REPEAT descriptive findings?
- Does each POV ladder: What → So What → Now What?
- Are connections, contradictions, and curiosities identified?

### Recommendation Quality
- Are recommendations quantified with specific numbers?
- Are they prioritized by Prize × Feasibility × Ease × Time × Fit?
- Do they map to real FMCG levers?
  - Distribution expansion (sell-in to retailers, new listings)
  - Pricing/pack architecture (bigger pack, multipack, price repositioning)
  - Promotion optimization (quality > quantity, reduce promo dependence)
  - Portfolio rebalancing (shift to whitespace segments)
  - Hero renovation (refresh declining top SKUs)
  - Tail pruning (cut low-performers to fund growth)

### Diagnostic Motifs (Flag if deck misses obvious patterns)
- Availability Problem: low dist + reasonable velocity → recommend distribution expansion
- Velocity Problem: high dist + weak velocity → recommend proposition/pricing fix
- Promo Dependence: intensity >50% → flag unsustainable, recommend baseline rebuild
- Portfolio Mismatch: mix gap >±5pp → recommend rebalancing
- Hero Concentration: top 3 >50% of value → flag fragility, recommend renovation

### Red Flags
- Memo-heavy deck where visuals should carry the argument
- So-what or now-what buried in prose instead of title
- Generic observations instead of quantified strategic recommendations
- Missing the biggest demand pool or whitespace opportunity`,
};

export function buildDomainKnowledgeContext(args: {
  workspace?: EvidenceWorkspace;
  brief: string;
  stage: DomainKnowledgeStage;
}) {
  const pack = scoreDomainKnowledgePacks(args)
    .filter((match) => match.activated)
    .sort((left, right) => right.score - left.score)[0];

  if (!pack) {
    return "";
  }

  const matchedSignals = [
    ...pack.matchedBriefCues.slice(0, 4),
    ...pack.matchedDataCues.slice(0, 6),
  ];

  return `## DOMAIN KNOWLEDGE PACK: NIQ STORYMASTERS FMCG

Activated because this run looks like FMCG / CPG / retail / category work.
Matched signals: ${matchedSignals.join(", ")}

${STAGE_PAYLOADS[args.stage]}`;
}
