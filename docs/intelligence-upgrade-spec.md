# Intelligence Upgrade Spec — Basquio V7 Quality

**Date:** 2026-04-16 (v2 — architecture-aware rewrite)
**Author:** Claude (forensic review + architecture analysis) + Marco (direction)
**Trigger:** Stefania Verini (senior NielsenIQ analyst) reviewed Kellanova/Pringles deck
**Runs analyzed:** `185751ff` (Francesco, 20 slides, Opus, $9.87), `239ae954` (Marco, 30 slides, Opus, $12.98)

---

## 0. Architecture Philosophy: Why This Spec Exists

This is NOT just a prompt engineering spec. Prompt changes have zero defensibility — anyone can copy them. This spec upgrades Basquio's quality at **three architectural layers**, each with increasing defensibility:

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER A: PROPRIETARY KNOWLEDGE PACKS (High Moat)            │
│   Copywriting Skill · Recommendation Framework              │
│   NIQ Analyst Playbook · Speaker Notes Coaching              │
│   → Reusable domain IP. Compounds with analyst feedback.     │
│   → Competitor can copy v1 but not 6 months of refinements.  │
├─────────────────────────────────────────────────────────────┤
│ LAYER B: DETERMINISTIC VALIDATION (High Moat)               │
│   Writing Linter · Evidence Validator · Tone Detector        │
│   Recommendation Specificity Checker                         │
│   → Code-enforced guardrails. Every bug becomes permanent.   │
│   → Compounds with every failed production run.              │
├─────────────────────────────────────────────────────────────┤
│ LAYER C: PROMPT INSTRUCTIONS (Low Moat, but necessary)      │
│   System prompt rules · Author message context               │
│   Few-shot examples · Depth tier instructions                │
│   → Table stakes. Required but not defensible alone.         │
├─────────────────────────────────────────────────────────────┤
│ LAYER D: ANALYST FEEDBACK LOOP (Highest Moat, future)       │
│   Stefania's edits → diff pipeline → knowledge pack updates  │
│   → The generative moat. Widens gap over time.               │
│   → Impossible for competitor to replicate without ICP users. │
└─────────────────────────────────────────────────────────────┘
```

**The Clone Test (from Menlo Ventures):** If a competitor replicated our codebase today, they could copy Layer C (prompts) in a day. Layer A (knowledge packs) in a week. Layer B (validation rules) in a month. But Layer D (compounding analyst feedback) takes 6+ months of real NielsenIQ usage — and that's the moat.

**Research basis:** Menlo Ventures "Vertical AI" (Apr 2026), 2Slides "State of AI Presentations" (Apr 2026), Deckary/Slideworks/Analyst Academy consulting methodology, production AI architecture best practices (IBM, Google Cloud, Analytics Vidhya).

---

## 1. Diagnosis: What Stefania Actually Said

| Feedback (Italian) | Translation | Root cause | Layer fix |
|---|---|---|---|
| "Analiticamente ottimo" | Analysis is excellent | Working. Don't touch. | — |
| "Non è da dare così ai clienti" | Not client-presentable as-is | Tone + evidence presentation | A + B |
| "Messaggi troppo strong/aggressivi per Pringles" | Messages too confrontational for the paying client | Writing like internal analyst, not client consultant | A + B |
| "Da molti insight senza mostrare i numeri" | Gives insights without showing supporting numbers | Assertions without visible data tables | A + B + C |
| "La faremo lunga almeno 4 volte tanto" | A real deliverable would be 4x longer | 18-20 slides vs 60-100 expected | C |
| PPT notes "veramente utilissime" | Speaker notes genuinely useful | Working. Double down. | A |

**The 80/20 verdict:** Basquio does 60-80% of the work (saves 2-3 days). The analyst's 20% is tone polishing + evidence augmentation + expanding to full length. Our job is to make that 20% as small as possible.

---

## 2. Forensic Evidence: Current Output Problems

### 2.1 Tone Problems (from Francesco's narrative report)

Direct quotes from the Kellanova/Pringles deck that Stefania flagged as "troppo strong":

| Current (aggressive) | Problem | Fix (client-pleasing) |
|---|---|---|
| "Pringles è intrappolato in tre gabbie strutturali" | Calling the client "trapped" | "Tre leve strutturali possono sbloccare crescita per Pringles" |
| "Il problema non è difendere il tubo, ma diversificare" | Telling client what NOT to do | "Il tubo resta il pilastro del fatturato — la diversificazione apre crescita incrementale" |
| "chi si ferma perde" | Confrontational/judgmental | "I player con portafoglio diversificato crescono più velocemente" |
| "è un problema di rilevanza del formato tubo/Reconstituted" | Calling their product irrelevant | "Il formato tubo affronta un contesto di categoria che premia la diversificazione" |
| "il tubo è un formato del passato" (deck slide) | Insulting their hero product | "I formati emergenti crescono 5x la media: l'espansione del portafoglio cattura questo valore" |
| "Pringles non ha un problema di brand equity" | Starting with "problema" | "Il brand Pringles ha equity forte — la crescita richiede nuove occasioni d'uso" |
| "La risposta non è difendere il tubo" | Negative framing | "La base tubo si protegge meglio aggiungendo formati che reclutano nuovi shopper" |
| "La PL soffre in questa categoria" | Irrelevant negative framing | "Il consumatore premia marca e innovazione: opportunità per chi investe" |

**Pattern:** The analysis reaches the right conclusions but frames them as *problems with the client* instead of *opportunities for the client*. A NielsenIQ analyst presenting to Kellanova's Category Director must make them feel empowered, not attacked.

### 2.2 Evidence Density Problems

From the deck slides, many analytical slides present insights without co-located data:
- Slide says "San Carlo cresce diversificando" but doesn't show the portfolio breakdown table on the same slide
- Recommendations reference €4.8M opportunity but the calculation isn't visible on-slide
- Charts appear without data tables — the analyst can't validate numbers at a glance

**NielsenIQ standard:** Every analytical slide has chart LEFT + data table RIGHT (or chart TOP + table BOTTOM). The chart tells the story, the table provides validation numbers.

### 2.3 Slide Count Problem

- Francesco's run: 20 slides for a full category review brief
- Marco's run: 30 slides for the same brief
- NielsenIQ standard for this brief complexity: 60-100 slides
- Current hard cap: `MAX_TARGET_SLIDES = 30`
- DB constraint: `check (target_slide_count between 1 and 30)`

### 2.4 Lint Warnings (Confirming Problems)

From Francesco's `authorLint`:
- "Only 2 layout types used across 20 slides (minimum 5)" — monotonous layout
- ">40% of slides use 'two-column' layout (19/20)" — no variety
- Multiple slides with "Non-cover title has no number" — topic labels, not insights
- "Title is a topic label, not an insight: 'Tre segnali strutturali'" — generic titles

From Marco's `authorLint`:
- "Only 2 layout types used across 30 slides (minimum 5)"
- ">40% of slides use 'CLIENT_MASTER' layout (29/30)"
- Em dash in title (banned pattern)

### 2.5 Contract Violations

- "Slide 18 recommendation contains unsupported numbers (€7.2m, €4.8m, €2.4m)" — fabricated financial projections
- "Slide 19 recommendation contains unsupported numbers (€4.0m)" — same issue
- These are the exact kind of problems Stefania would catch: numbers that look precise but aren't traceable to the data

### 2.6 What Works (Don't Break)

- Narrative report: 473 lines, 26K chars — genuinely deep analysis
- SCQA structure in exec summary — textbook consulting
- Recommendation framework with base/bull/bear scenarios — excellent
- Speaker notes — confirmed "veramente utilissime"
- Data appendix with cross-tabs — useful for analyst validation
- Competitive deep-dive (San Carlo, Mondelez, PepsiCo, Fiorentini) — thorough

---

## 3. LAYER A: Proprietary Knowledge Pack Upgrades

### 3.1 Upgrade: `basquio-copywriting-skill.md` (Client-Facing Tone System)

The copywriting skill is currently 110 lines covering anti-patterns and voice rules. It needs a **new major section: Client-Facing Tone** that becomes the most important section in the document. This is proprietary IP — every line represents institutional knowledge about how FMCG consulting decks should read.

#### 3.1.1 The Category Director Test

**Add as the FIRST rule in the copywriting skill:**

> Every sentence in the deck must pass the "Category Director test": would the person paying for this analysis feel empowered, not attacked? This does NOT mean removing hard truths. It means framing them as opportunities. The insight stays accurate; only the framing changes.

#### 3.1.2 The Tone Hierarchy (5 rules)

1. **Lead with the client's strengths** — "Pringles è il secondo brand di categoria con €91M" before any challenge
2. **Frame challenges as market dynamics, not client failures** — "il segmento Reconstituted affronta un contesto di categoria in evoluzione" not "Pringles perde"
3. **Frame recommendations as growth unlocks** — "Diversificare il portafoglio sblocca tre pool di crescita" not "il tubo non basta"
4. **Quantify the upside, not the downside** — "€4.8M incrementali nel Multipack" not "-5% nel tubo"
5. **Acknowledge the client's existing strengths before suggesting changes** — always start with what they're doing right

#### 3.1.3 Banned Client-Aggressive Framing Patterns

- **BANNED:** Starting a sentence with "Il problema è..." / "The problem is..."
- **BANNED:** "non basta" / "non è sufficiente" / "is not enough"
- **BANNED:** "è intrappolato/bloccato" / "is trapped/stuck"
- **BANNED:** "fallimento" / "failure" (use "area di miglioramento" / "improvement area")
- **BANNED:** "del passato" / "from the past" when referring to client's products
- **BANNED:** "nonostante" / "despite" at sentence start (implies the client should have done better)
- **BANNED:** Negative framing of the client's hero product/format
- **BANNED:** "La risposta non è X" / "The answer is not X" (say what TO do, not what not to do)

#### 3.1.4 Required Client-Pleasing Patterns

- **REQUIRED:** Before any challenge, state the client's relevant strength
- **REQUIRED:** Frame every decline as an opportunity for the opposite action
- **REQUIRED:** Quantify opportunity size before quantifying problem size
- **REQUIRED:** Use "il mercato si muove verso..." not "il cliente non si muove verso..."
- **REQUIRED:** Recommendations use imperative + opportunity size: "Espandere X per catturare €Y"

#### 3.1.5 Reframing Table (Concrete Examples)

| Analyst-to-analyst (internal) | Consultant-to-client (external) |
|---|---|
| "Pringles is losing because..." | "Kellanova can capture €X by..." |
| "The canister is a format from the past" | "Emerging formats grow 5x the category average — portfolio expansion unlocks this value" |
| "You have a problem with..." | "There's an opportunity in..." |
| "The brand is trapped in..." | "Three structural levers can accelerate growth..." |
| "The answer is not to defend X" | "X remains the revenue pillar — Y adds incremental growth" |
| "Competitors are winning because you're not..." | "Players with diversified portfolios grow faster — this playbook is replicable" |

#### 3.1.6 Italian Client-Pleasing Refinements

- "Quando scrivi per il cliente, usa il tono di un consulente che presenta al board: rispettoso della storia del brand, entusiasta delle opportunità, concreto sui numeri."
- "Mai attaccare il prodotto hero del cliente. Il tubo Pringles ha costruito un brand da €91M — rispettalo e posiziona la diversificazione come crescita incrementale."
- "Usa 'opportunità' 3x più spesso di 'sfida'. Usa 'crescita' 3x più spesso di 'calo'."

### 3.2 New Knowledge Pack: `basquio-recommendation-framework.md`

A dedicated proprietary knowledge pack for recommendation quality. This separates recommendation methodology from the general copywriting skill, making it a standalone reusable asset.

#### 3.2.1 Recommendation Structure (Mandatory)

Every recommendation must follow this structure:

```
OPPORTUNITY: [Quantified upside] — what the client can GAIN
ACTION: [Specific FMCG lever] — what to DO
RATIONALE: [Data-backed reasoning] — WHY this works (cfr. slide N)
TIMELINE: [Quarter + milestone]
```

#### 3.2.2 BCG 3-Step Recommendation Pattern

Adopted from real BCG client deliverables:
1. **Overarching areas of action** — 3-5 strategic themes
2. **Concrete initiatives** — specific, granular sub-initiatives within each theme
3. **Prioritization** — effort × impact matrix or numbered priority ranking

#### 3.2.3 Bain Evidence-Anchoring Pattern

Every recommendation is framed by **contrasting to its key finding** from the analysis. This gives the client assurance that recommendations are data-driven and anchors each action in visible evidence.

Example:
```
FINDING (slide 7): Multipack grows +5.0% while Large Sharing declines -2.1%
RECOMMENDATION: Catturare €4,8M nel Multipack
  → Sviluppare un Multipack Pringles (3-5 pz) per Super e Hyper 2500-4999
  → Il Multipack è il secondo formato per dimensione (€159,9M) e il primo per crescita
  → Kellanova ha spazio per una quota immediata del 3% (cfr. slide 7)
  → Q3 2026: lancio. Q4 2026: primo read.
```

#### 3.2.4 Recommendation Title Rules

- **BANNED:** "Lanciare X" (imperative without quantification)
- **REQUIRED:** "Catturare €X attraverso Y" or "Sbloccare €X con Y"
- Every recommendation title must contain a € or % number

#### 3.2.5 Scenario Framing

Keep base/bull/bear structure but rename for Italian client context:
- "Scenario Bear" → "Scenario Prudente" (less negative connotation)
- "Scenario Bull" → "Scenario Ambizioso"
- "Scenario Base" stays

#### 3.2.6 Impact Summary Slide

After individual recommendation cards, include a summary slide showing expected total impact across all recommendations. This is standard at BCG/Bain — helps client understand cumulative value and prioritize resource allocation.

### 3.3 Upgrade: Speaker Notes Coaching Framework

Speaker notes are confirmed as high-value ("veramente utilissime"). Upgrade from ~50-100 words to **200-400 words per slide** with structured coaching framework.

#### 3.3.1 Speaker Notes Structure

```
TALK TRACK (1-2 sentences)
How to introduce this slide in a presentation setting.

DATA CONTEXT (2-3 sentences)
The full numerical context that doesn't fit on the slide. Include exact numbers,
calculation methodology, and caveats the presenter should know.

PRESENTING TO A SKEPTICAL AUDIENCE (2-3 sentences)
How to frame this if the audience pushes back. Strongest counter-argument
and how to address it with data.

ANTICIPATED QUESTIONS (2-3 Q&A pairs)
Q: [Likely question from Category Director]
A: [Data-backed answer with slide reference]

TRANSITION (1 sentence)
How to bridge to the next slide.
```

#### 3.3.2 Coaching Tone

Written as if coaching the analyst who will present:
- "Quando presenti questa slide, parti dal dato positivo: 'Il mercato snack salati vale oltre un miliardo di euro...'"
- "Se il Category Director chiede perché Pringles cala, usa la cornice della diversificazione di portafoglio, non la narrazione del 'formato in declino'"
- "Preparati alla domanda: 'Ma Pringles Tortilla l'abbiamo già provato.' La risposta è che il posizionamento precedente era replicativo, non differenziante."

---

## 4. LAYER B: Deterministic Validation Upgrades

The writing linter (`packages/intelligence/src/writing-linter.ts`) currently checks 16 AI slop patterns + Italian false friends + language mismatch. It needs **new positive quality rules** that enforce the copywriting skill programmatically.

### 4.1 New Lint Rule: Client-Aggressive Tone Detector

**File:** `packages/intelligence/src/writing-linter.ts`

Add detection for the banned client-aggressive patterns:

```typescript
const CLIENT_AGGRESSIVE_PATTERNS = [
  { pattern: /\bil problema è\b/i, message: "Client-aggressive: 'il problema è' — reframe as opportunity" },
  { pattern: /\bintrappolat[oa]\b/i, message: "Client-aggressive: 'intrappolato' — use 'può sbloccare'" },
  { pattern: /\bnon basta\b/i, message: "Client-aggressive: 'non basta' — reframe positively" },
  { pattern: /\bdel passato\b/i, message: "Client-aggressive: 'del passato' — don't call client products outdated" },
  { pattern: /\bfallimento\b/i, message: "Client-aggressive: 'fallimento' — use 'area di miglioramento'" },
  { pattern: /^nonostante\b/im, message: "Client-aggressive: sentence starts with 'nonostante'" },
  { pattern: /\bthe problem is\b/i, message: "Client-aggressive: 'the problem is' — reframe as opportunity" },
  { pattern: /\bis trapped\b/i, message: "Client-aggressive: 'is trapped'" },
  { pattern: /\bfrom the past\b/i, message: "Client-aggressive: 'from the past'" },
];
```

**Severity:** major (blocks approval at critique phase, triggers revise)

### 4.2 New Lint Rule: Evidence Co-location Validator

**File:** `packages/intelligence/src/writing-linter.ts` (or new file)

Validate at the manifest level that analytical slides have co-located evidence:

```typescript
function validateEvidenceColocation(manifest: DeckManifest): LintIssue[] {
  const analyticalArchetypes = ['title-chart', 'chart-split', 'evidence-grid', 'comparison'];
  const exemptArchetypes = ['cover', 'section-divider', 'exec-summary', 'recommendation-cards', 'summary'];
  
  return manifest.slides
    .filter(s => analyticalArchetypes.includes(s.archetype))
    .filter(s => !s.hasDataTable && !s.hasChartAnnotations)
    .map(s => ({
      slide: s.slideNumber,
      severity: 'minor', // advisory for now, upgrade to major after testing
      message: `Slide ${s.slideNumber} has chart but no co-located data table. Add addTable() with supporting numbers.`
    }));
}
```

**Severity:** minor initially (advisory), upgrade to major after 2 weeks of production validation.

### 4.3 New Lint Rule: Recommendation Specificity Checker

Detect generic recommendations that lack specificity:

```typescript
const GENERIC_RECOMMENDATION_PATTERNS = [
  { pattern: /\bmigliorare la distribuzione\b/i, message: "Too generic: specify which SKU, which retailer, which ACV target" },
  { pattern: /\bimprove distribution\b/i, message: "Too generic: specify SKU, retailer, ACV target" },
  { pattern: /\bespandere la presenza\b/i, message: "Too generic: specify channel, format, target quota" },
  { pattern: /\bincrease market share\b/i, message: "Too generic: specify by how much, in which segment" },
  { pattern: /\bottimizzare il portafoglio\b/i, message: "Too generic: specify which SKUs to add/remove" },
];
```

**Severity:** minor (advisory — guides revise without blocking)

### 4.4 Upgrade: Number-in-Title Enforcer

Currently exists as a lint warning. Upgrade to a **major violation** for non-cover, non-divider slides:

```typescript
// Current: minor warning
// Proposed: major violation (triggers revise)
if (!titleHasNumber && !isExemptSlide) {
  violations.push({
    severity: 'major',
    message: `Slide ${n} title has no number. Must state insight with ≥1 specific number.`
  });
}
```

---

## 5. LAYER C: Prompt Instruction Changes

### 5.1 Evidence Co-location Rule (Author Message)

Add to `buildAuthorMessage()`:

```
EVIDENCE CO-LOCATION RULE: Every analytical slide must show its supporting numbers.
- If a slide has a chart, include a compact data table (max 6 rows × 4 cols) with the key numbers.
- If a slide states "Brand X grows Y%" then Y% must be visible in a table or chart annotation.
- Data table goes RIGHT of chart (chart-split) or BELOW chart (title-chart).
- Use PptxGenJS addTable() with compact styling: font size 9-10, alternating row fill, right-aligned numbers.
- Exception: Executive Summary and Recommendation slides reference prior evidence via "cfr. slide N".
```

### 5.2 Tone Calibration Instruction (Author Message)

Add to `buildAuthorMessage()`:

```
CLIENT-FACING TONE: The client is paying for this deck. Frame every finding as an opportunity.
- Lead with the client's strengths before any challenge
- Frame challenges as market dynamics, not client failures
- Quantify the upside before the downside
- Use the reframing patterns from the Copywriting Skill's Client-Facing Tone section
```

### 5.3 Few-Shot Example: Evidence-Grid with Co-located Table (System Prompt)

Add a new named example to system-prompt.ts:

```javascript
// EXAMPLE: evidence-grid with chart LEFT + data table RIGHT
// Slide: "San Carlo cresce +1,7% diversificando su 10 brand — Kellanova cala -5,0% concentrata sul tubo"
const chartPath = 'competitor_share_chart.png'; // rendered via matplotlib
slide.addImage({ path: chartPath, x: 0.4, y: 1.3, w: 5.5, h: 3.2 });
slide.addTable(
  [
    [{ text: 'Produttore', options: { bold: true, fontSize: 9 } }, 
     { text: 'Val €M', options: { bold: true, fontSize: 9, align: 'right' } },
     { text: 'Quota %', options: { bold: true, fontSize: 9, align: 'right' } },
     { text: 'Δ pp', options: { bold: true, fontSize: 9, align: 'right' } }],
    ['San Carlo', '245,2', '24,0%', '+0,6'],
    ['Mondelez', '97,8', '9,6%', '+0,1'],
    ['Kellanova', '93,7', '9,2%', '-0,4'],
    ['PepsiCo', '38,4', '3,8%', '-0,2'],
  ],
  { x: 6.2, y: 1.3, w: 3.4, h: 2.8, fontSize: 9, 
    rowH: [0.3, 0.25, 0.25, 0.25, 0.25],
    colW: [1.2, 0.7, 0.7, 0.7],
    border: { type: 'solid', pt: 0.5, color: 'D6D1C4' },
    autoPage: false }
);
```

### 5.4 Few-Shot Example: Client-Pleasing Recommendation (System Prompt)

Add a new named example showing opportunity-first framing:

```javascript
// EXAMPLE: recommendation card with opportunity-first framing
// Title: "Catturare €4,8M nel Multipack — il formato in maggiore crescita (+5,0%)"
// NOT: "Kellanova ha quota zero nel Multipack"
slide.addText('Catturare €4,8M nel Multipack', { 
  x: 0.4, y: 1.2, w: 9.2, fontSize: 18, bold: true, color: '0B0C0C' 
});
// Action card 1
slide.addText([
  { text: '01', options: { fontSize: 28, bold: true, color: '1A6AFF' } },
  { text: '\n\nMultipack Pringles (3-5 pz)\n', options: { fontSize: 12, bold: true } },
  { text: 'Sviluppare per Super e Hyper 2500-4999. Il Multipack è il secondo formato per dimensione (€159,9M) e il primo per crescita. Quota immediata del 3% = €4,8M (cfr. slide 9).', options: { fontSize: 10, color: '5D656B' } },
  { text: '\n\nLeva: Pack Architecture | Timeline: Q3 2026 | Impatto: €4,8M base', options: { fontSize: 9, color: '6B7280' } },
], { x: 0.4, y: 2.0, w: 4.4, h: 3.2, valign: 'top', fill: { color: 'FBF8F1' } });
```

### 5.5 Slide Count Expansion

#### 5.5.1 Limit Changes

| Layer | Current | Proposed |
|---|---|---|
| `MAX_TARGET_SLIDES` (credits.ts) | 30 | **100** |
| DB constraint (deck_runs) | 1-30 | **1-100** |
| UI slider max (generation-form.tsx) | 30 | **100** (unlimited users), 30 (paid users) |
| `assertValidSlideCount()` | 1-30 | **1-100** |
| Supabase RPC functions | 1-30 | **1-100** |

#### 5.5.2 Tiered Depth Instructions

| Slides | Tier | Instruction |
|---|---|---|
| 1-3 | Memo | "Focused executive brief. Top-line KPIs and 1-2 key insights only." |
| 4-10 | Summary | "Concise category summary. 1-2 slides per chapter. 4-6 insights." |
| 11-20 | Standard | "Standard consulting deck. 2-3 slides per chapter. Full diagnostic depth with SCQA. Every analytical slide shows co-located data." |
| 21-40 | Deep-dive | "Extended consulting deck. 3-5 slides per chapter. Deep-dive each segment, channel, competitor individually. Cross-tab analysis, promotional analysis, detailed recommendation cards with base/bull/bear scenarios." |
| 41-70 | Full report | "Full NielsenIQ-grade category review. 4-6 slides per chapter. Every cross-tabulation gets its own slide. Include all standard chapters: exec summary, market overview, segment deep-dives, competitive landscape, channel analysis, promotional analysis, portfolio analysis, recommendations, roadmap, appendix." |
| 71-100 | Complete book | "Complete analytical book. Maximum-depth deliverable. Every data dimension gets dedicated slides. SKU-level analysis, retailer-specific deep-dives, sensitivity analysis for every recommendation, detailed methodology appendix, full data appendix." |

#### 5.5.3 Standard Chapter Structure by Tier

| Chapter | 10 slides | 20 slides | 40 slides | 60 slides | 100 slides |
|---|---|---|---|---|---|
| Cover | 1 | 1 | 1 | 1 | 1 |
| Exec Summary | 1 | 1-2 | 2-3 | 3-5 | 3-5 |
| Market Overview | 1-2 | 2-3 | 3-5 | 5-8 | 8-12 |
| Segment Deep-dives | 1-2 | 3-4 | 5-8 | 8-15 | 15-25 |
| Competitive Landscape | 1 | 2-3 | 3-5 | 5-8 | 8-12 |
| Channel Analysis | — | 1-2 | 2-4 | 4-6 | 6-10 |
| Promo Analysis | — | 1 | 2-3 | 3-4 | 4-6 |
| Portfolio Analysis | — | 1-2 | 2-3 | 3-4 | 4-6 |
| Recommendations | 1-2 | 2-3 | 3-5 | 5-8 | 8-12 |
| Roadmap/Next Steps | 1 | 1-2 | 2-3 | 2-3 | 3-4 |
| Appendix | — | — | 2-5 | 5-10 | 10-15 |

#### 5.5.4 Cost & Budget Implications

- 20 slides (Opus): $9.87 (observed)
- 30 slides (Opus): $12.98 (observed)
- 60 slides (Opus): ~$18-22 (projected)
- 100 slides (Opus): ~$25-35 (projected)

Budget cap changes for ≥40 slides: pre-flight $25.00, hard cap $35.00, cross-attempt $40.00

### 5.6 Chart + Table Co-location Patterns

#### Pattern A: Chart-Split with Table (preferred)
- Chart: left 60% (x: 0.4, w: 5.5)
- Table: right 35% (x: 6.2, w: 3.4)
- Max table size: 8 rows × 4 columns

#### Pattern B: Chart Top + Table Bottom (for wide charts)
- Chart: top 55% (y: 1.2, h: 2.8)
- Table: bottom 35% (y: 4.2, h: 2.0)
- Max table size: 6 rows × 6 columns

#### Table Styling

```javascript
const tableStyle = {
  fontSize: 9, fontFace: 'Arial',
  border: { type: 'solid', pt: 0.5, color: 'D6D1C4' },
  color: '0B0C0C', rowH: 0.25, autoPage: false,
  headerRow: { fill: 'F5F1E8', bold: true, fontSize: 9 },
  altRow: { fill: 'FBF8F1' },
};
// Right-align numeric columns, left-align text columns
```

#### Exceptions (no co-located table needed)
- Cover, Section divider, Executive summary (uses KPI cards), Recommendation cards (reference via "cfr. slide N"), Summary/next-steps

---

## 6. LAYER D: Analyst Feedback Loop (Future — Design Now, Build Next)

### 6.1 The Flywheel

```
Stefania runs Basquio deck (2x/week)
  → Silvia edits the deck (adds slides, adjusts tone, adds cross-tabs)
  → Stefania sends us the edited final version
  → We diff Basquio output vs final version
  → Diffs become knowledge pack entries + lint rules
  → Next deck is better
  → Repeat
```

### 6.2 What the Diff Captures

| Diff type | What it tells us | Where it goes |
|---|---|---|
| Slide title rewordings | Tone calibration failures | Copywriting skill banned/required patterns |
| Added slides | Missing depth at this tier | Depth tier instructions |
| Removed slides | Unnecessary content | System prompt restraint rules |
| Recommendation edits | Framing/specificity gaps | Recommendation framework |
| Data table additions | Evidence co-location gaps | Evidence validation rules |
| Speaker note edits | Coaching gaps | Speaker notes framework |
| Chart type changes | Exhibit selection failures | NIQ Analyst Playbook |

### 6.3 Implementation Approach (Not in This Sprint)

1. Build a simple upload endpoint for "analyst-edited deck" per run
2. Extract slide titles + text via PPTX parser
3. Diff against original Basquio output stored in artifacts
4. Surface diffs in a dashboard for manual review
5. Manually update knowledge packs based on patterns

This doesn't need to be automated initially. Marco/Francesco review diffs weekly and manually update knowledge packs. The automation can come later once we understand the pattern language.

### 6.4 Why This Is the Highest Moat

From Menlo Ventures (April 2026):
> "The companies hardest to replicate are those whose products improve with usage in ways that are specific to their vertical and unavailable to general-purpose entrants. Not data at rest, but decision quality that compounds from interactions, corrections, and edge cases accumulated over time."

A competitor can copy Basquio's prompts on day 1. They cannot copy 6 months of NielsenIQ analyst corrections on day 1. This is the data flywheel that creates an irreplicable advantage.

---

## 7. Implementation Plan (Architecture-Aware)

### 7.1 Priority Order with Layer Tags

| # | Change | Layer | File(s) | Defensibility | Effort |
|---|---|---|---|---|---|
| 1 | Add Client-Facing Tone section to copywriting skill | **A** | `docs/domain-knowledge/basquio-copywriting-skill.md` | High | 0.5 day |
| 2 | Create recommendation framework knowledge pack | **A** | `docs/domain-knowledge/basquio-recommendation-framework.md` (NEW) | High | 0.5 day |
| 3 | Add client-aggressive tone detector to linter | **B** | `packages/intelligence/src/writing-linter.ts` | High | 0.5 day |
| 4 | Add evidence co-location validator | **B** | `packages/intelligence/src/writing-linter.ts` | High | 0.5 day |
| 5 | Add recommendation specificity checker | **B** | `packages/intelligence/src/writing-linter.ts` | High | 0.5 day |
| 6 | Upgrade number-in-title to major violation | **B** | `packages/intelligence/src/writing-linter.ts` | High | 0.25 day |
| 7 | Add tone calibration instruction to author message | **C** | `packages/workflows/src/generate-deck.ts` | Low | 0.25 day |
| 8 | Add evidence co-location instruction to author message | **C** | `packages/workflows/src/generate-deck.ts` | Low | 0.25 day |
| 9 | Add chart+table few-shot example to system prompt | **C** | `packages/workflows/src/system-prompt.ts` | Low | 0.25 day |
| 10 | Add client-pleasing recommendation few-shot example | **C** | `packages/workflows/src/system-prompt.ts` | Low | 0.25 day |
| 11 | Upgrade speaker notes instruction | **C** | `packages/workflows/src/system-prompt.ts` + `generate-deck.ts` | Low | 0.25 day |
| 12 | Raise MAX_TARGET_SLIDES to 100 | **C** | `credits.ts` + `generation-form.tsx` | Low | 0.5 day |
| 13 | New Supabase migration (1-100 range) | **C** | `supabase/migrations/` (NEW) | Low | 0.25 day |
| 14 | Replace depth tier instructions (6-tier system) | **C** | `packages/workflows/src/generate-deck.ts` | Low | 0.5 day |
| 15 | Raise Opus budget caps for ≥40-slide runs | **C** | `packages/workflows/src/cost-guard.ts` | Low | 0.25 day |
| 16 | Register recommendation-framework.md in KNOWLEDGE_PACK_FILES | **C** | `packages/workflows/src/system-prompt.ts` | Low | 0.1 day |

**Total: ~5 days of implementation**

### 7.2 Files NOT Changed

- `packages/workflows/src/anthropic-execution-contract.ts` — no architecture changes
- `packages/scene-graph/src/slot-archetypes.ts` — current archetypes support all needed layouts
- `scripts/worker.ts` — no worker changes
- Pipeline flow — no phase changes

### 7.3 Validation Matrix

| Stefania's feedback | Layer A fix | Layer B fix | Layer C fix | Validation |
|---|---|---|---|---|
| "Messaggi troppo strong" | Copywriting skill tone section | Client-aggressive detector | Tone instruction | Run Kellanova brief, zero aggressive framing |
| "Da molti insight senza mostrare i numeri" | — | Evidence co-location validator | Evidence instruction + example | Every analytical slide has data table |
| "La faremo lunga almeno 4 volte tanto" | — | — | Slide count to 100 + depth tiers | Run same brief at 60 slides |
| "Non è da dare così ai clienti" | All tone rules | All validators | All instructions | End-to-end tone check |
| "Note PPT utilissime" | Speaker notes framework | — | Speaker notes instruction | 200-400 words per slide |

### 7.4 Risk Assessment

| Risk | Mitigation |
|---|---|
| Tone softening removes analytical edge | Banned patterns target *framing*, not *content*. Same insight, different frame |
| Evidence co-location makes slides too dense | Max table 8×4 with compact styling. Tables are supporting, not primary |
| 100-slide decks cost $25-35 on Opus | Only available to unlimited users. Paid users capped at 30 |
| 100-slide decks take 40+ minutes | Acceptable for category review depth. Analyst would take 2-3 days |
| Client-aggressive linter has false positives | Start as major (triggers revise), downgrade to minor if too noisy |
| New knowledge pack increases token count | Recommendation framework is ~200 lines. Fits within cache budget |
| Speaker notes bloat file size | Text-only notes, minimal impact on PPTX size |

---

## Appendix A: State-of-the-Art Research (Deep Dive)

### A.1 MBB Consulting Slide Standards (Deckary, Analyst Academy, Slideworks — scraped April 2026)

**Core Rules Shared by McKinsey, BCG, Bain:**

1. **Action titles, not topic titles.** Every slide title states a complete-sentence conclusion with ≥1 number. Maximum 15 words, never exceed 2 lines. *(Basquio already does this — confirmed in system prompt.)*

2. **One message per slide.** "If you find yourself writing 'and' in your action title, you probably need two slides." *(Basquio already does this via archetype constraints.)*

3. **Pyramid Principle (answer first).** Lead with recommendation, then support with evidence. *(Basquio's SCQA/deductive structure already matches.)*

4. **Source everything.** Every data point needs attribution. *(Basquio partially does this — source lines exist but aren't consistently on every slide.)*

5. **60-second rule (McKinsey).** Each slide should be explainable in 60 seconds. If not, split.

6. **Titles test.** "Can someone understand your argument by reading only the slide titles?"

**BCG "Smart Simplicity" Test (should adopt):**
Before including anything on a slide, ask: Does this directly support the action title? Can the reader understand it in 5 seconds? Is there a simpler way to show this?

**BCG Color for Emphasis (should adopt):**
In a bar chart comparing 8 segments, 7 bars are gray and 1 is the accent color. The colored bar IS the message.

### A.2 Recommendation Best Practices (Slideworks, Deckary — scraped)

From real McKinsey, BCG, Bain recommendation slides:
1. Group recommendations into 3-9 logical categories
2. Use active language: Start with verbs
3. Add numbers to each recommendation for easy reference
4. Frame by contrasting to key findings (Bain approach)
5. End with expected impact summary

### A.3 Data Storytelling Frameworks (Beautiful.ai — scraped)

Five proven frameworks: "So What?", OIA (Observation-Insight-Action), Data-to-Story Arc, 1-3-1, McKinsey Pyramid. The OIA framework maps perfectly to Basquio's "WHAT/HOW MUCH/WHY/SO WHAT" at slide level.

### A.4 Client-Facing Tone: Diplomatic Framing

Core principle: "Reframing should not distort content." The insight stays accurate; only the framing changes. "The client will only follow advice that reflects their own desires — frame findings in a way that aligns with their goals."

### A.5 Vertical AI Defensibility (Menlo Ventures, April 2026)

Key insight: Vertical AI companies build two types of moats: **defensive moats** (domain investment, compliance) that slow competitors, and **generative moats** (compounding data, cross-customer signal) that widen the gap over time. The most durable companies have both.

**The Clone Test:** If you replicated the founding team and codebase today, why wouldn't it outcompete the original? Answer: the clone cannot quickly replicate the data, feedback, and learnings through real-world task execution.

**The value flywheel:** Agent ingests domain data → develops judgment → earns trust → embeds deeper → generates feedback signals → improves → expands scope → captures more value.

### A.6 AI Presentation Market (2Slides, April 2026)

- $4.7B global market (52% YoY growth)
- 78% adoption in management consulting
- 87% satisfaction for quarterly business reviews
- 81% of users rate AI slides as equal/better than manual
- Presentation agents (autonomous end-to-end) are the dominant paradigm

### A.7 Production AI Architecture (IBM, Google Cloud, Analytics Vidhya)

Layered approach: prompt engineering first (75-85% accuracy), RAG/knowledge packs second (88-94%), fine-tuning third (92-97%). Most production systems combine all three. "Start with prompt engineering, as most teams underinvest here despite its speed, low cost, and surprising effectiveness when done well."

### A.8 Current Quality Stack Analysis

The explorer agent mapped 5 existing quality layers: Knowledge Packs → System Prompt → Author Message → Deterministic Validation → Feedback Loop (critique→revise→export). Identified 8 gaps: no cross-run learning, late-stage-only validation, chart contract output-only, lint rules text-only (no positive enforcement), no model-specific quality gates, recommendation quality unvalidated, no competitive richness check, no analysis depth validation.

---

## Appendix B: Production Run Telemetry

### Francesco's Kellanova Run (185751ff)
- **Model:** claude-opus-4-6
- **Slides:** 20 (target 20)
- **Cost:** $9.87 (author $5.89 + revise $3.89 + QA $0.09)
- **Continuations:** 0
- **Visual QA:** green (8.2/10)
- **Lint:** 10 actionable issues (8 slide, 2 deck)
- **Contract:** 2 violations (unsupported €M numbers in recommendations)
- **Narrative:** 26,920 bytes, 473 lines

### Marco's Kellanova Run (239ae954)
- **Model:** claude-opus-4-6
- **Slides:** 30 (target 30)
- **Cost:** $12.98 (author $6.39 + revise $6.46 + QA $0.13)
- **Continuations:** 0
- **Visual QA:** green (8.2/10)
- **Lint:** 6 actionable issues (4 slide, 2 deck)
- **Contract:** passed
- **Narrative:** 28,141 bytes, 445 lines

---

## Appendix C: Sources

### Consulting Slide Standards & Methodology
- [Consulting Slide Standards: Rules McKinsey, BCG & Bain Follow](https://deckary.com/blog/consulting-slide-standards) — Deckary, 2025
- [BCG Presentation Style: Formatting Like a Consultant](https://deckary.com/blog/bcg-presentation-style) — Deckary, 2025
- [Consulting Presentations: The MBB Guide to Professional Slides](https://deckary.com/blog/pillar-consulting-presentations-guide) — Deckary, 2026
- [3 Great Examples of Slide Structure from McKinsey, Bain, and BCG](https://www.theanalystacademy.com/consulting-slide-structure/) — Analyst Academy
- [How to write recommendation slides like a consultant](https://slideworks.io/resources/how-to-write-recommendation-slides) — Slideworks
- [Five Steps to Make a Presentation Using Strategy Consulting Principles](https://strategyu.co/consulting-presentations/) — StrategyU, 2025

### Client Presentation & Diplomatic Tone
- [How to Create a Winning Client Presentation](https://slidemodel.com/client-presentation/) — SlideModel, 2025
- [How McKinsey Consultants Make Presentations](https://slideworks.io/resources/how-mckinsey-consultants-make-presentations) — Slideworks

### Data Storytelling & Visualization
- [Data Storytelling That Works: 5 Proof-Backed Frameworks](https://www.beautiful.ai/blog/data-storytelling-that-works-5-proof-backed-frameworks-for-communicating-insights-clearly) — Beautiful.ai, 2026
- [Data Visualization Best Practices](https://www.tableau.com/visualization/data-visualization-best-practices) — Tableau

### Vertical AI Defensibility & Architecture
- [Software Finally Gets to Work: The Opportunity in Vertical AI](https://menlovc.com/perspective/software-finally-gets-to-work-the-opportunity-in-vertical-ai/) — Menlo Ventures, April 2026
- [AI Killed the Feature Moat. Here's What Actually Defends Your SaaS Company in 2026](https://medium.com/@cenrunzhe/ai-killed-the-feature-moat-heres-what-actually-defends-your-saas-company-in-2026-9a5d3d20973b) — Steven Cen, Feb 2026
- [RAG vs Fine-Tuning vs Prompt Engineering](https://www.analyticsvidhya.com/blog/2026/03/fine-tuning-vs-rag-vs-prompt-engineering/) — Analytics Vidhya, 2026
- [RAG vs fine-tuning vs prompt engineering](https://www.ibm.com/think/topics/rag-vs-fine-tuning-vs-prompt-engineering) — IBM

### AI Presentation Market
- [State of AI Presentations in 2026](https://2slides.com/blog/state-of-ai-presentations-2026-trends-stats-predictions) — 2Slides, April 2026

### NielsenIQ / FMCG
- [NIQ Brand Traction 2025 - West Europe](https://nielseniq.com/global/en/insights/analysis/2025/niq-brand-traction-2025-west-europe/) — NIQ
- [Sweets & Snacks 2025](https://nielseniq.com/global/en/events/2025/sweets-and-snacks-2025/) — NIQ
- [Snacks Insights](https://nielseniq.com/global/en/insights/cpg-foods/snacks/) — NIQ
