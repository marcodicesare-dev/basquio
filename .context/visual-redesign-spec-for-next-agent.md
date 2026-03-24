# Basquio Visual Redesign Spec
## Exact direction for the next implementation agent

**Date:** 2026-03-24
**Status:** Spec only. Previous agent failed on visual taste. This document is the brief for whoever implements next.
**Reference:** basedash.com (composition, width, density, artifact quality)

---

## CONTEXT: WHAT EXISTS AND WHAT'S WRONG

The product backend works. The billing works. The workspace shell has all the right pages (billing, settings, recipes, reports, brand system). The pricing is correct. The data pipeline produces real decks. Google OAuth works. Email templates are branded.

**The problem is 100% visual execution and composition.**

The current site looks assembled, not designed. It has the right words but the wrong visual delivery. Specifically:

1. **The hero is badly composed.** A big dark slab with tiny floating proof assets. The showcase slides are small, pixelated, and weak. They read as placeholders.
2. **The showcase slides themselves are bad artifacts.** They are text-heavy SVG-to-PNG conversions with 8pt body paragraphs. A hero proof artifact needs ONE gorgeous chart-led slide, not three mediocre text walls.
3. **The page is narrow and stacked.** Every section is a boxed card in a vertical stack. Basedash uses the full viewport width, mixes section sizes, and creates visual rhythm.
4. **The pricing cards work structurally but feel thin visually.** They need more height, better spacing, visual weight on the recommended tier.
5. **The app shell is "complete" but not polished.** It has the right routes but the sidebar feels like a list of links, not a product navigation.

---

## EXACT HERO COMPOSITION

### What to build

ONE dominant artifact occupying the right 55% of the hero. Not three tiny stacked thumbnails. Not an SVG. A single high-resolution PNG that looks like a real report room or a single gorgeous deck slide.

### The artifact must be

- **Chart-led.** The dominant visual element is a beautiful bar chart, waterfall, or horizontal bar — NOT a text paragraph. Think McKinsey slide: big chart, short title, one callout.
- **960x540px minimum** at 2x retina (1920x1080 source). It must look sharp at full hero width.
- **Real data.** Use the verified Affinity numbers (€2.23B market, Cat €1.38B, Dog €833M).
- **Basquio design language.** White background, #1a6aff blue accent, #0b0c0c text, sharp corners, NielsenIQ source footer.

### The artifact must NOT be

- A text wall with 4 metric cards and 4 paragraphs (current)
- Three small thumbnails in a stack (current)
- A generic chart with no data context
- An SVG that renders differently across browsers

### How to generate it

Option A: Use Python (matplotlib/seaborn) to render a beautiful horizontal bar chart with the Affinity data, export as PNG at 1920x1080.

Option B: Use Figma/design tool to create a pixel-perfect slide mockup.

Option C: Actually run the Basquio pipeline on the Affinity data and screenshot the best slide from the real output.

Option C is the only honest option. The hero should show ACTUAL OUTPUT, not a mockup.

### Hero layout

```
┌──────────────────────────────────────────────────────────────┐
│ DARK HERO STAGE (full width, no horizontal padding)          │
│                                                              │
│  Left 40%              │  Right 55%                          │
│                        │                                     │
│  EYEBROW               │  ┌─────────────────────────────┐   │
│  (small, gold)         │  │                             │   │
│                        │  │   ONE BIG SLIDE             │   │
│  H1 (2 lines max)     │  │   with chart                │   │
│                        │  │   that looks premium        │   │
│  Subhead (1 line)      │  │                             │   │
│                        │  │   (540px tall, sharp shadow) │   │
│  [CTA button]          │  │                             │   │
│                        │  └─────────────────────────────┘   │
│  proof pills           │                                     │
│                        │  PPTX · PDF · 11 slides             │
└──────────────────────────────────────────────────────────────┘
```

The slide should have a subtle rotation (1-2deg) and shadow to feel like a physical artifact.

---

## EXACT HOMEPAGE LAYOUT SYSTEM

### Current problem

The homepage is a vertical stack of boxed sections: hero → social proof → pipeline → output → proof → use cases → pricing → getting started → CTA. Each section is a `.panel` or `.technical-panel` card with internal padding. This creates a narrow, repetitive, cardy feel.

### Target

Fewer sections. Wider. More editorial. Mixed layouts (not all boxed cards).

### Proposed section order (6 sections, not 10)

1. **Hero** (dark, full-width, 2-column: copy + artifact)
2. **Trust strip** (light, compact, single row: "Built by ex-NielsenIQ" + 3 stats)
3. **Product loop** (dark panel, wider cards, 4 steps but styled as a horizontal flow not a grid of equal boxes)
4. **Output proof** (light, 2-column: large slide screenshot on left, feature bullets on right — NOT two text-only cards)
5. **Pricing snapshot** (light, 3 tiers inline, link to full pricing)
6. **CTA** (dark panel, one line, one button)

### Sections to REMOVE from the homepage

- "Proof points" (the evidence/brand/system SVG cards) — these are filler
- "Use cases" (the 4 persona cards) — move to /solutions or kill
- "Getting started" (the numbered dark panel) — redundant with CTA

### Visual rules for sections

- Hero: dark, no card border, full bleed
- Trust strip: light, no card, just content on canvas
- Product loop: dark technical panel, but wider — use full container width
- Output proof: light, NO panel border — just content on canvas with one large image
- Pricing: light, panel cards for tiers
- CTA: dark panel

---

## EXACT ARTIFACT STYLE DIRECTION

Every visual asset on the site must pass this test: **"Would a NielsenIQ analyst look at this and think it came from a real category review?"**

### Chart style for showcase slides

- **Horizontal bar chart** (the NIQ standard for category/brand comparisons)
- 5-7 bars, sorted by value descending
- Bar colors: #1a6aff for primary brand, #e8e4db for others
- Value labels at end of each bar (€781M, €354M, etc.)
- Growth rate next to each value (+1.4%, -4.6%)
- Y-axis: segment names (Cat Nutrition Wet, Cat Nutrition Dry, etc.)
- No gridlines. Clean. Professional.
- Source footer: "Source: NielsenIQ RMS IT All Banners 2025"

### Typography on slides

- Title: 20-24pt, bold, black, max 2 lines
- Subtitle: 13pt, muted gray
- Bar labels: 12pt, regular
- Values: 12pt, bold
- Source: 9pt, gray

### What NOT to put on showcase slides

- Body paragraphs (the current showcase is mostly text paragraphs)
- 4+ metric cards competing for attention
- "KEY FINDING" callout boxes
- More than one chart per slide

---

## EXACT APP SHELL AESTHETIC DIRECTION

### Current problem

The sidebar is a list of text links in a bordered panel. It works but feels like a prototype. The content area is a narrow column of stacked cards.

### Target

The sidebar should feel like product navigation, not a settings menu. Reference: Basedash sidebar has icons next to each nav item, uses a darker background for the active state, and has more visual weight.

### Specific changes

1. **Add icons** to each nav item (Phosphor icons are already in the project):
   - Home → House
   - New report → Plus
   - Reports → Files
   - Recipes → Repeat
   - Brand system → Palette
   - Billing → CreditCard
   - Settings → Gear

2. **Sidebar background**: slightly darker than canvas — `var(--canvas-2)` or similar

3. **Active state**: stronger — not just a blue left border, but a visible background fill

4. **Credit balance display**: larger, more prominent, with a visual bar showing how much is left

5. **Content area**: use more of the horizontal space. The current cards are narrower than they need to be.

---

## TRUST BUG FIX LIST (code, not visual)

These are code-level bugs that need fixing regardless of visual direction. Most were already fixed in commit 9fda57c, but verify:

| Bug | Status | Details |
|-----|--------|---------|
| Pricing contradiction ($10/report vs credit math) | **Fixed** | Credit packs removed from public pricing |
| Billing stats count debits not completions | **Fixed** | Labels now say "Runs started" and "Completed" |
| Settings hardcodes "Email + password" | **Fixed** | Now says "Email + password, Google" |
| Logo links to / instead of /dashboard | **Fixed** | Now links to /dashboard |
| Refund path not wired | **Already worked** | Worker calls refundCredit on failure, gated behind STRIPE_SECRET_KEY |
| Generation form: conflicting template + brand file | **Not fixed** | User can select saved template AND upload a brand file. Need mutual exclusion. |
| Evidence file removal doesn't work | **Not fixed** | No remove button on evidence file chips. Only brand file has remove. |
| Brand file re-add fails after remove | **Not fixed** | React state clears but hidden input doesn't, so same file can't be re-added |

### Still to fix (code):

1. Add remove button to evidence file chips
2. Make template selection and brand file upload mutually exclusive (clear one when the other is set)
3. Clear the hidden file input when removing a brand file (set input.value = "")

---

## WHAT THE NEXT AGENT MUST DO

1. **Generate one beautiful chart-led slide PNG** using matplotlib or the actual pipeline output. This is the hero artifact.
2. **Recompose the homepage** with the 6-section structure above. Wider, fewer sections, editorial flow.
3. **Restyle the hero** around the single dominant artifact. No tiny stacked thumbnails.
4. **Add icons to sidebar nav** using Phosphor.
5. **Fix the 3 remaining code bugs** (file removal, template mutual exclusion, input clearing).
6. **Visually verify every change in the browser** before committing. Screenshot each page. If it doesn't look good, don't ship it.

## COPY VOICE RULES (CRITICAL)

The brand tagline is **"Beautiful Intelligence."** — this is sacred, do not change it.

The hero headline **"Two weeks of analysis. Delivered in hours."** — this stays exactly as is.

### Copy must be:
- **Human-crafted.** Talks to humans, friendly, non-arrogant, brilliant. Like a smart colleague, not a brochure.
- **Simple.** A 12-year-old should understand what the product does. No jargon.
- **YC-style clarity.** Say what it does in plain words. No staccato AI patterns.
- **Opinionated with taste.** Every word earns its place. If a sentence doesn't add value, delete it.

### Copy must NOT be:
- AI slop staccato patterns ("Streamline your workflow. Leverage your data. Transform insights.")
- Jargon nobody uses in real life ("evidence-to-executive reporting", "deterministic analysis pipeline")
- Arrogant or self-congratulatory ("the most powerful", "revolutionary", "game-changing")
- Generic SaaS copy that could describe any product
- Em dashes used as sentence connectors

### Examples of good copy (already in the product):
- "Two weeks of analysis. Delivered in hours." (hero — clear, human, specific)
- "Beautiful Intelligence." (tagline — evocative, memorable, distinctive)
- "Upload your data. Get back a finished analysis." (subhead — says what it does)
- "Story by AI. Math by code." (proof point — clever, concise)

### Examples of bad copy (that was incorrectly introduced):
- "Evidence-to-executive reporting" (jargon, nobody talks like this)
- "6 free credits to start" (internal mechanics exposed to users)
- "Enough for a 3-slide executive brief" (actively deterring)

### What the next agent must NOT do

- Add more pages or routes (we have enough)
- Touch the generation pipeline
- Change the hero headline or tagline (Marco wrote them, they stay)
- Rewrite copy in AI-slop staccato style
- Add animations or transitions
- Switch to Tailwind or any other CSS framework
- Add new npm dependencies unless absolutely necessary
- Use words like "leverage", "streamline", "empower", "transform", "elevate"
