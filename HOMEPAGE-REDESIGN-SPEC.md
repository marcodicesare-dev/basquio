# Basquio Homepage Redesign — Implementation Spec

## Implementation Status

- [x] Part 1: Homepage Redesign
- [x] Part 2: Pipeline Brand Alignment
- [x] Part 3: Pipeline Rendering Quality
  - [x] Fix 1: Brand colors
  - [x] Fix 2: Basquio logo on cover + footer icon
  - [x] Fix 3: Chart sizing alignment + minimum render guard
  - [x] Fix 4: Layout variety enforcement
  - [x] Fix 5: Schema validation hardening
  - [x] Fix 6: Chart design polish rules/examples
  - [x] Fix 7: Dark theme matplotlib preamble
  - [ ] Production validation runs still need to be executed commit-by-commit if you want the full protocol in this spec, but the implementation work below is now in place.

## Context

The current homepage is bloated, has no conversion framework, and reads like AI slop. This spec defines an exact section-by-section rewrite following PAS/PASTOR/StoryBrand frameworks, Basedash-level minimalism, and 2026 landing page best practices.

## Hard constraints

- **DO NOT** change the hero headline: "Two weeks of analysis. Delivered in hours."
- **DO NOT** change the tagline: "Beautiful Intelligence."
- **DO NOT** change the brand: colors (cream `#FAF8F3` bg, dark panels), font (Roc Grotesk), logo
- **DO NOT** change the nav component (`public-site-nav.tsx`) — it already has the hamburger menu
- **DO NOT** change the footer component (`public-site-footer.tsx`)
- **DO NOT** change the footer CTA component (`public-site-footer-cta.tsx`) — but update the props passed to it
- **DO** create `apps/web/src/components/slide-showcase.tsx` for the interactive tab showcase (Section 4). This is the only new file needed.
- **DO NOT** add illustrations, stock photos, or AI-generated images
- **DO NOT** use emoji anywhere
- Keep total page copy under 300 words (currently ~450)
- The page must be beautiful on both desktop (1440px) and mobile (375px)
- All CSS goes in `apps/web/src/app/global.css` using the existing class naming patterns

## Files to modify

1. `apps/web/src/app/page.tsx` — complete rewrite of the page component (keep metadata/imports)
2. `apps/web/src/app/global.css` — update/add CSS for new sections, remove dead classes from old sections
3. `apps/web/src/app/site-content.ts` — remove `heroSignals` export (no longer used)
4. `apps/web/src/components/slide-showcase.tsx` — NEW client component for interactive tab slide viewer (Section 4)

## Existing assets available

- `/showcase/slide-showcase-executive.svg` — executive overview slide (KPI cards, key finding)
- `/showcase/slide-showcase-chart.svg` — bar chart slide (segment performance)
- `/showcase/slide-showcase-recommendations.svg` — recommendations slide
- These are the ONLY product visuals. Use them in a bento/grid layout in the output showcase section.

## Existing components to reuse

- `PublicSiteNav` from `@/components/public-site-nav` — nav with hamburger (already done)
- `PublicSiteFooter` from `@/components/public-site-footer` — footer (keep as-is)
- `PublicSiteFooterCta` from `@/components/public-site-footer-cta` — dark panel CTA (update props)
- `Image` from `next/image`, `Link` from `next/link`

## Existing CSS patterns to follow

- `.landing-shell`, `.landing-shell-editorial` — page wrapper
- `.section-label`, `.section-label.light` — eyebrow text (small caps, tracked)
- `.dark-panel` — dark background sections
- `.technical-panel` — dark gradient background sections
- `.muted` — secondary text color
- `.button` — primary blue button
- `.button.secondary` — outline button
- `.button.secondary.inverted` — outline button for dark backgrounds
- `.stack` — vertical flex with gap
- `.stack-xl` — vertical flex with larger gap
- `.row` — horizontal flex with gap

---

## Section-by-section spec

### Section 1: Hero (ATTENTION)

**Framework role:** Hook + single clarifying line + CTA. Under 30 words above the fold.

**Structure:**
```
section.hero-stage.marketing-hero.marketing-hero-editorial
  div.hero-main
    div.stack
      p.section-label.light  ->  "Beautiful Intelligence."
      h1                     ->  "Two weeks of analysis. Delivered in hours."
      p.hero-subtitle        ->  "Upload your data. Get back a finished deck."
    div.row
      Link.button            ->  "Try it with your data"  href="/jobs/new"
      Link.button.secondary.inverted  ->  "See how it works"  href="/how-it-works"
  div.hero-artifact-column
    (use slide-showcase-executive.svg in a tilted/floating frame -- same as current but WITHOUT any chips, meta text, or artifact-evidence-row below it)
```

**What's removed vs current:**
- Kill `heroSignals` proof pills entirely
- Kill `hero-artifact-meta` div (chips + description below image)
- Shorten subtitle from 35 words to 8 words
- Change secondary CTA from "See pricing" to "See how it works" (reduces friction -- pricing is a commitment, "how it works" is curiosity)

**Copy (exact):**
- Eyebrow: `Beautiful Intelligence.`
- H1: `Two weeks of analysis. Delivered in hours.`
- Subtitle: `Upload your data. Get back a finished deck.`
- CTA primary: `Try it with your data`
- CTA secondary: `See how it works`

**Total above-fold words: ~25** (down from ~80)

---

### Section 2: Social proof bar (TRUST)

**Framework role:** Immediate credibility. Subtle. Not a full section -- just a thin strip.

**Structure:**
```
section.social-proof-bar
  p  ->  "Built by category analysts and brand managers who lived the reporting cycle."
```

**CSS:** Light background (cream), centered text, `font-size: 0.85rem`, `color: var(--muted)`, padding `24px 0`, no heading, no label. Just one line of text. Subtle and quiet.

**Why this copy:** It's the StoryBrand "Guide" -- establishes that Basquio was built by people who understand the problem, without claiming fake trust metrics. When real logos/numbers exist, replace this line with a logo bar.

**Total words: ~14**

---

### Section 3: Problem / Agitation (PAS-P + PAS-A)

**Framework role:** Name the visitor's pain. Make them feel it. No solution yet.

**Structure:**
```
section.problem-section
  div.stack
    p.section-label  ->  "The bottleneck"
    h2               ->  "You already have the data. The deck is what takes two weeks."
  div.problem-grid  (3-column grid on desktop, single column on mobile)
    article.problem-card
      h3  ->  "Manual chart-building"
      p   ->  "Every chart copied from a spreadsheet. Every axis label fixed by hand."
    article.problem-card
      h3  ->  "Formatting over analysis"
      p   ->  "More time aligning boxes than interpreting what the numbers mean."
    article.problem-card
      h3  ->  "A first draft nobody trusts"
      p   ->  "The deck goes out with a caveat. The team presents something unfinished."
```

**CSS:** Cream/light background. Cards with subtle border (`1px solid var(--border)`), `border-radius: 10px`, padding `24px`. Grid: `grid-template-columns: repeat(3, 1fr)` on desktop, `1fr` on mobile. No icons, no illustrations. Just text.

**Total words: ~60**

---

### Section 4: Transformation — Interactive Slide Showcase (PASTOR-T + PAS-S)

**Framework role:** Show the "after" state. What life looks like with Basquio. This is where the product visual lives. **MUST be interactive** — clickable tabs that switch a full-width slide with smooth crossfade animation. Pattern from Linear/Vercel feature sections.

**This section requires a new client component:** `apps/web/src/components/slide-showcase.tsx`

**Structure:**
```
section.transformation-section.dark-panel
  div.stack (centered)
    p.section-label.light  ->  "The output"
    h2                     ->  "Upload once. Present tomorrow."
    p.muted                ->  "A finished analysis deck with real charts, a narrative report, and an editable PPTX. Ready to review, not rebuild."

  SlideShowcase (client component)
    div.showcase-tabs  (pill segmented control, centered)
      button[role="tab"]  ->  "Executive Overview"   (active by default)
      button[role="tab"]  ->  "Segment Analysis"
      button[role="tab"]  ->  "Recommendations"
    div.showcase-viewport  (full-width, 16:9 aspect ratio)
      div.showcase-panel[data-active]  ->  slide-showcase-executive.svg
      div.showcase-panel               ->  slide-showcase-chart.svg
      div.showcase-panel               ->  slide-showcase-recommendations.svg
```

**Component implementation (`slide-showcase.tsx`):**
```tsx
"use client";

import { useState } from "react";
import Image from "next/image";

const slides = [
  {
    id: "executive",
    label: "Executive Overview",
    src: "/showcase/slide-showcase-executive.svg",
    alt: "Executive overview slide with KPI cards, segment breakdown, and key finding",
  },
  {
    id: "segment",
    label: "Segment Analysis",
    src: "/showcase/slide-showcase-chart.svg",
    alt: "Segment performance slide with horizontal bar chart and growth rates",
  },
  {
    id: "recommendations",
    label: "Recommendations",
    src: "/showcase/slide-showcase-recommendations.svg",
    alt: "Recommendations slide with prioritized next actions",
  },
] as const;

export function SlideShowcase() {
  const [active, setActive] = useState(slides[0].id);

  return (
    <div className="slide-showcase">
      <div className="showcase-tabs" role="tablist" aria-label="Output slides">
        {slides.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={active === s.id}
            aria-controls={`panel-${s.id}`}
            className={`showcase-tab${active === s.id ? " active" : ""}`}
            onClick={() => setActive(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="showcase-viewport">
        {slides.map((s) => (
          <div
            key={s.id}
            id={`panel-${s.id}`}
            role="tabpanel"
            className={`showcase-panel${active === s.id ? " active" : ""}`}
            aria-hidden={active !== s.id}
          >
            <Image
              src={s.src}
              alt={s.alt}
              width={960}
              height={540}
              priority={s.id === slides[0].id}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

**CSS for the showcase (add to global.css):**
```css
/* ── Slide showcase (interactive tab viewer) ── */

.slide-showcase {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  width: 100%;
}

/* Tab bar: pill segmented control (Linear/Vercel pattern) */
.showcase-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--surface-dark-2);
  border-radius: 9999px;
  border: 1px solid var(--border-inverse);
}

.showcase-tab {
  padding: 10px 24px;
  border-radius: 9999px;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  font-family: inherit;
  letter-spacing: -0.01em;
  background: transparent;
  color: var(--text-inverse-soft);
  transition: background 0.2s ease, color 0.2s ease;
}

.showcase-tab:hover {
  color: var(--text-inverse);
}

.showcase-tab.active {
  background: rgba(255, 255, 255, 0.12);
  color: var(--text-inverse);
}

/* Viewport: full-width with 16:9 aspect ratio, crossfade stack */
.showcase-viewport {
  position: relative;
  width: 100%;
  max-width: 960px;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
  border: 1px solid var(--border-inverse);
}

/* Panels: absolute stacked, opacity crossfade */
.showcase-panel {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.4s ease-in-out;
  pointer-events: none;
}

.showcase-panel.active {
  opacity: 1;
  pointer-events: auto;
}

.showcase-panel img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Mobile: tab labels shrink */
@media (max-width: 640px) {
  .showcase-tab {
    padding: 8px 14px;
    font-size: 0.75rem;
  }
}
```

**Key design decisions:**
- Tab bar uses pill segmented control (dark container, `border-radius: 9999px`, active tab has `rgba(255,255,255,0.12)` background)
- All 3 panels are always in the DOM, stacked with `position: absolute; inset: 0`
- Active panel gets `opacity: 1`, others get `opacity: 0`
- `transition: opacity 0.4s ease-in-out` creates smooth crossfade (outgoing and incoming overlap during transition)
- `pointer-events: none` on hidden panels prevents accidental clicks
- Full ARIA tab pattern for accessibility
- No extra dependencies — pure CSS transitions on GPU-accelerated `opacity` property
- Timing: 200ms for tab highlight, 400ms for crossfade (matches Linear/Vercel)

**Total words: ~35**

---

### Section 5: How it works (StoryBrand Plan)

**Framework role:** Simple 3-step plan that makes the path obvious. Reduces perceived effort.

**Structure:**
```
section.how-it-works-section
  div.stack
    p.section-label  ->  "How it works"
    h2               ->  "Three steps. One reporting cycle."
  div.steps-row  (3-column horizontal layout)
    article.step-card
      span.step-number  ->  "01"
      h3                ->  "Upload your evidence"
      p                 ->  "Spreadsheets, notes, PDFs, and a template if you have one."
    article.step-card
      span.step-number  ->  "02"
      h3                ->  "Basquio builds the deck"
      p                 ->  "Analysis, charts, narrative, and formatting. One loop."
    article.step-card
      span.step-number  ->  "03"
      h3                ->  "Review and send"
      p                 ->  "Edit the PPTX, share the PDF. Same story, both formats."
```

**CSS:** Cream/light background. Step number: large blue circle with white number (same style as current `home-flow-index`). Cards: no border, just the number + text. Clean and spacious.

On mobile: single column stack.

**Total words: ~55**

---

### Section 6: Pricing snapshot (PASTOR-O -- Offer)

**Framework role:** Remove friction. Show that trying is free and paid plans are simple.

**Keep the current pricing snapshot section EXACTLY as-is.** It works. Same `pricingSnapshot` array, same grid, same highlighted Pro card. No changes needed.

**Total words: ~60**

---

### Section 7: Footer CTA (PASTOR-R -- Response)

**Framework role:** Final push. Confidence + urgency. Single clear action.

**Use existing `PublicSiteFooterCta` component with updated props:**
```tsx
<PublicSiteFooterCta
  eyebrow="Ready to start"
  title="Put one live review through Basquio."
  copy="Start with the files behind a real meeting. If the first draft is strong enough to edit, the workflow is doing its job."
  primaryLabel="Try it with your data"
  primaryHref="/jobs/new"
  secondaryLabel="See pricing"
  secondaryHref="/pricing"
/>
```

**(This is already what's in the current page. Keep it.)**

---

### Section 8: Footer

**Use existing `PublicSiteFooter` component. No changes.**

---

## Total page word count

| Section | Words |
|---------|-------|
| Hero | ~25 |
| Social proof | ~14 |
| Problem/Agitation | ~60 |
| Transformation | ~35 |
| How it works | ~55 |
| Pricing | ~60 |
| Footer CTA | ~30 |
| **Total** | **~279** |

Down from ~450. Under the 300-word target.

---

## CSS cleanup

Remove these dead classes from `global.css` that are only used by the old homepage (grep first to confirm no other page uses them):
- `.hero-proof-strip`, `.hero-proof-pill` -- hero pills removed
- `.hero-artifact-meta`, `.artifact-evidence-row`, `.artifact-chip` -- artifact chips removed
- `.trust-strip`, `.trust-strip-grid`, `.trust-stat` -- trust section replaced
- `.home-output-proof`, `.home-output-visual`, `.output-bullet-list`, `.output-bullet` -- output section replaced

Add new classes:
- `.social-proof-bar` -- thin centered text strip
- `.problem-section`, `.problem-grid`, `.problem-card` -- pain point grid
- `.transformation-section` -- dark panel wrapper for the showcase
- `.slide-showcase`, `.showcase-tabs`, `.showcase-tab`, `.showcase-viewport`, `.showcase-panel` -- interactive tab slide viewer with crossfade
- `.how-it-works-section`, `.steps-row`, `.step-card`, `.step-number` -- 3-step plan

---

## What NOT to do

- The ONLY JavaScript interaction on the homepage is the slide showcase tab switcher (Section 4). No other animations or JS.
- Do NOT add a video or animated demo -- we don't have one. The SVG slides are sufficient for now.
- Do NOT add fake social proof (made-up user counts, fake logos). The single credibility line is honest.
- Do NOT add more than 3 pain points in the problem section. Three is the limit.
- Do NOT make the showcase images clickable beyond the tab switching. No lightbox, no zoom, no hover effects.
- Do NOT add a "features" section. The transformation + how-it-works sections cover this implicitly.
- Do NOT change the pricing snapshot structure -- it works.
- Do NOT remove the `heroSignals` export from `site-content.ts` if other pages import it -- check first with grep.
- Do NOT use words like "revolutionary", "cutting-edge", "game-changing", "powerful", "seamless", or any other AI slop qualifiers.
- Do NOT add comments like "Removed old section" or "Previously: ..."
- Do NOT add TypeScript types or interfaces that aren't needed
- Do NOT refactor unrelated code

## Visual reference

Study basedash.com for the aesthetic direction:
- Bold centered headline, minimal subtitle, dual CTA
- Product video/visual below hero with vignette fade
- Logo strip for social proof
- Clean sections with generous whitespace
- Dark/light section alternation
- No clutter, no pills, no chips, no badges

The Basquio version should feel like basedash.com but with warm cream backgrounds instead of pure black, and the existing Basquio brand identity (Roc Grotesk, gold accent, blue CTAs).

## Verification

After implementation, visually verify in browser at both 1440px and 375px:
1. Above-the-fold on desktop shows: nav + hero headline + subtitle + CTAs + product visual. Nothing else.
2. Above-the-fold on mobile shows: nav (collapsed hamburger) + hero headline + subtitle + CTAs. Product visual may be below fold on mobile -- that's fine.
3. No horizontal overflow on any section at 375px.
4. All text is readable, no clipping, no truncation.
5. Total page length is shorter than current (fewer sections, less text).
6. The page "breathes" -- generous whitespace between sections.
7. Dark/light section alternation: Hero (dark) -> Social proof (light) -> Problem (light) -> Transformation (dark) -> How it works (light) -> Pricing (light) -> Footer CTA (dark) -> Footer (light).

---
---

# PART 2: Pipeline Template Brand Alignment Spec

## Problem statement

The "Basquio House Style" template that generates the default PPTX/PDF output does NOT match the Basquio brand system. The website says one thing; the output decks say another. A user who sees the warm cream + ultramarine + bright amber website, then receives a deck with different amber, different blue, sharp corners, and plain Arial — that's a broken brand promise.

This was confirmed by inconsistencies visible in recent production runs.

## Forensic audit: what's wrong

### Color mismatches

| Token | Brand (`docs/brand-system.md`) | Web (`global.css`) | Pipeline Slate template | Pipeline Bower (actual export default) |
|-------|------|-----|----------------|-------|
| **Amber/accent** | `#F0CC27` | `#F0CC27` (`--amber`) | `#E8A84C` | N/A (uses gray `#1F2937`) |
| **Blue/CTA** | `#1A6AFF` | `#1A6AFF` (`--blue`) | Not used | `#2563EB` (chart only) |
| **Primary text** | `#0B0C0C` | `#0B0C0C` (`--text`) | `#F2F0EB` (inverted, dark bg) | `#1A1A2E` (close but not exact) |
| **Background** | Not specified | `#f5f1e8` (warm cream) | `#0A090D` (near-black) | `#FFFFFF` (plain white) |
| **Slate/muted** | `#6B7280` | `#6B7280` (`--slate`) | `#A09FA6` / `#6B6A72` | `#6B7280` (matches) |

**Verdict:** The pipeline amber (`#E8A84C`) is a completely different color from the brand amber (`#F0CC27`). The pipeline blue varies across templates. Bower text is `#1A1A2E` instead of the brand onyx `#0B0C0C`.

### Chart palette mismatch

The pipeline chart palette (`code/design-tokens.ts`):
```
#E8A84C  #4CC9A0  #6B8EE8  #9B7AE0  #E8636F  #5AC4D4  #E8B86C  #7ABBE0
```

This palette was never derived from the brand system. The lead color uses the wrong amber. The blue (`#6B8EE8`) doesn't match ultramarine (`#1A6AFF`).

### Spacing/radius mismatch

- Web uses `border-radius: 4-8px` everywhere. Pipeline Slate uses `cardRadius: 0.12"` (~9px at 72dpi, close enough). But Bower (the actual export default) uses `cardRadius: 0` — sharp corners.
- The scene-graph fallback also uses `cardRadius: 0`.

### "Basquio | Confidential" footer

- Uses the `muted` color from whichever theme is active, not a consistent brand color
- Font size 8pt in mono font — fine, but should use brand slate `#6B7280` consistently

## What needs to change

### Font: NO CHANGE needed
Arial is correct for PPTX. Web fonts (Manrope) cannot be embedded. This is intentional and correct.

### Colors: ALIGN to brand system

**Files to modify:**
1. `packages/template-engine/src/index.ts` — `createSystemTemplateProfile()` brand tokens
2. `packages/render-pptx/src/render-v2.ts` — `SLATE_TOKENS` object
3. `code/design-tokens.ts` — `BASQUIO_COLORS` and `BASQUIO_CHART_PALETTE`
4. `packages/scene-graph/src/index.ts` — default brand tokens fallback

**Slate template (Basquio-branded dark theme) corrections:**

| Token | Current | Should be | Rationale |
|-------|---------|-----------|-----------|
| accent | `#E8A84C` | `#F0CC27` | Match brand amber exactly |
| accentLight | `#1A1922` | `rgba(240,204,39,0.12)` equivalent = `#1A1A12` | Derived from correct amber |
| highlight | `#E8A84C` | `#F0CC27` | Match brand amber |

**Bower template (light export default) corrections:**

| Token | Current | Should be | Rationale |
|-------|---------|-----------|-----------|
| ink (text) | `#1A1A2E` | `#0B0C0C` | Match brand onyx |
| accent | `#1F2937` | `#0B0C0C` | Use brand onyx as authority accent |
| chart lead color | `#2563EB` | `#1A6AFF` | Match brand ultramarine |

**Chart palette correction (`code/design-tokens.ts`):**

Current:
```
#E8A84C  #4CC9A0  #6B8EE8  #9B7AE0  #E8636F  #5AC4D4  #E8B86C  #7ABBE0
```

Should be (brand-aligned, amber + ultramarine as first two):
```
#F0CC27  #1A6AFF  #4CC9A0  #9B7AE0  #E8636F  #5AC4D4  #6B7280  #7ABBE0
```

Rationale: lead with brand amber, second is brand ultramarine, rest keep the original variety but swap the off-brand amber variants for slate.

**Scene-graph fallback corrections (`packages/scene-graph/src/index.ts`):**

| Token | Current | Should be |
|-------|---------|-----------|
| text | `#0F172A` | `#0B0C0C` (brand onyx) |
| accent | `#2563EB` | `#1A6AFF` (brand ultramarine) |
| accentMuted | `#DBEAFE` | `rgba(26,106,255,0.12)` equivalent |

**Template-engine `createSystemTemplateProfile()` corrections:**

| Field | Current | Should be |
|-------|---------|-----------|
| `colors` array | `["#F2F0EB", "#E8A84C", "#4CC9A0", "#13121A", "#0A090D", "#272630"]` | `["#F2F0EB", "#F0CC27", "#1A6AFF", "#4CC9A0", "#0A090D", "#272630"]` |
| `brandTokens.palette.accent` | `#E8A84C` | `#F0CC27` |
| `brandTokens.palette.highlight` | `#E8A84C` | `#F0CC27` |

### Spacing: MINOR CHANGE

**Bower template only:**
| Token | Current | Should be |
|-------|---------|-----------|
| cardRadius | `0` | `0.06` (~4px, matches web `--radius-sm`) |

All other templates keep their current radius — they are designed for specific aesthetics.

### "Basquio | Confidential" footer: MINOR CHANGE

Use brand slate `#6B7280` as the footer text color regardless of theme, instead of inheriting from `muted` which varies per theme.

## What NOT to change

- Do NOT change Arial to Manrope or any web font. PPTX requires system fonts.
- Do NOT change the dark bg of Slate (`#0A090D`). Dark slides are a premium feature.
- Do NOT change Obsidian, Signal, or Verso templates — they are not "Basquio branded", they are alternative styles.
- Do NOT change the slide dimensions (13.333" x 7.5" wide).
- Do NOT change spacing tokens beyond the Bower cardRadius fix.
- Do NOT change the logo asset paths — they are correct.
- Do NOT change the "hide Basquio branding when client template is present" rule — it's correct.

## Validation

After making changes:
1. Run `pnpm qa:basquio` to verify type-checking passes
2. Run one production deck with the default Basquio template
3. Compare the output deck's cover slide accent color against `#F0CC27`
4. Compare the chart lead color against `#F0CC27` (Slate) or `#1A6AFF` (Bower)
5. Verify the executive overview KPI cards use the correct accent
6. Verify the footer text is `#6B7280` in both Slate and Bower exports

## Priority

This is PHASE 2 — after the homepage redesign ships. The homepage redesign is the immediate priority. This pipeline alignment should be done in a separate commit/PR.

---
---

# PART 3: Pipeline Rendering Quality — From 6.3/10 to 10/10

## Forensic audit of run `401e2826` (2026-04-02, Opus 4.6, 15 slides)

### Scores

| Dimension | Current | Target | Gap |
|-----------|---------|--------|-----|
| Analysis depth | 9/10 | 9/10 | None — world-class |
| Narrative quality | 9/10 | 9/10 | None — 12K+ tokens, Italian, SCQA |
| Chart accuracy | 7/10 | 9/10 | Label collisions, truncated annotations |
| Chart design | 5/10 | 8/10 | Wrong colors, 3 too-small charts, no visual hierarchy |
| Slide layout variety | 5/10 | 8/10 | 9/15 slides same layout (two-column) |
| Branding | 3/10 | 9/10 | No logo, wrong amber, footer only on master |
| **Overall** | **6.3/10** | **8.7/10** | **+2.4 points** |

### Root causes (ranked by impact)

1. **Wrong brand colors baked into 3 separate files** — `E8A84C` amber instead of `F0CC27` in render-v2.ts SLATE_TOKENS, code/design-tokens.ts, and template-engine/src/index.ts
2. **No Basquio logo on cover slide** — BASQUIO_COVER master has zero objects, no logo
3. **Chart figsize mismatch between prompt and renderer** — archetypes say `5.75x3.5` but render placement uses `12.133x4.55` from layout-regions. Claude renders at the archetype size, then the image gets stretched or placed too small
4. **9/15 slides use two-column** — no layout variety enforcement in system prompt
5. **3 charts rendered at ~283x175px** — Claude used figsize too small for evidence-grid/table layouts
6. **Massive schema violations** — 50+ Zod errors on analysis_result.json (chart.id, chartType, title, figureSize all wrong)
7. **Data label collisions** — matplotlib bar labels overlap on market share chart

---

## Fix 1: Brand color alignment (CRITICAL — from 3/10 to 8/10 branding)

### Problem
Three files define the pipeline colors independently. They drifted.

### Files to change

**A. `packages/render-pptx/src/render-v2.ts` — SLATE_TOKENS (line ~135)**

Change:
```
accent: "E8A84C"  →  "F0CC27"
accentLight: "1A1922"  →  "1A1A12"
```
And update SLATE chartPalette lead color:
```
chartPalette[0]: "E8A84C"  →  "F0CC27"
chartPalette[2]: "6B8EE8"  →  "1A6AFF"
```

**B. `packages/render-pptx/src/render-v2.ts` — BOWER_TOKENS (line ~219)**

Change:
```
ink: "1A1A2E"  →  "0B0C0C"
accent: "1F2937"  →  "0B0C0C"
chartPalette[0]: "2563EB"  →  "1A6AFF"
```

**C. `packages/template-engine/src/index.ts` — createSystemTemplateProfile() (line ~47)**

Change colors array:
```
["#F2F0EB", "#E8A84C", "#4CC9A0", "#13121A", "#0A090D", "#272630"]
→
["#F2F0EB", "#F0CC27", "#1A6AFF", "#4CC9A0", "#0A090D", "#272630"]
```

Change brandTokens.palette:
```
accent: "#E8A84C"  →  "#F0CC27"
highlight: "#E8A84C"  →  "#F0CC27"
accentMuted: "#1A1922"  →  "#1A1A12"
```

**D. `code/design-tokens.ts` — BASQUIO_CHART_PALETTE (line ~7)**

Already updated in docs/design-tokens.md. Verify the code matches:
```
["F0CC27", "1A6AFF", "4CC9A0", "9B7AE0", "E8636F", "5AC4D4", "6B7280", "7ABBE0"]
```

And BASQUIO_COLORS:
```
amber: "F0CC27"  (was "E8A84C")
amberDim: "C4A71F"  (was "B8832E")
blue: "1A6AFF"  (was "6B8EE8")
```

**E. `packages/scene-graph/src/index.ts` — default brand tokens (line ~640)**

Change:
```
accent: "#2563EB"  →  "#1A6AFF"
text: "#0F172A"  →  "#0B0C0C"
accentMuted: "#DBEAFE"  →  "rgba(26,106,255,0.12)" equivalent = "#E0EBFF"
```

---

## Fix 2: Basquio logo on cover slide (CRITICAL — branding)

### Problem
`BASQUIO_COVER` slide master has `objects: []`. No logo anywhere.

### Solution
Add the Basquio logo to the cover slide master in `render-v2.ts`:

```typescript
pptx.defineSlideMaster({
  title: "BASQUIO_COVER",
  background: { fill: norm(tokens.palette.coverBg) },
  objects: [
    // Basquio logo — bottom left of cover
    {
      image: {
        x: 0.6,
        y: 6.6,
        w: 1.8,
        h: 0.3,
        path: "brand/svg/logo/basquio-logo-dark-bg.svg",
        // Fallback for environments where SVG isn't supported:
        // Use the data URI approach or embed as base64 PNG
      },
    },
  ],
});
```

**IMPORTANT**: PptxGenJS cannot embed SVGs directly in all environments. The logo must be provided as either:
1. A base64-encoded PNG data URI (safest cross-platform)
2. A URL accessible at render time

The implementation should:
1. Read `/brand/png/logo/2x/basquio-logo-dark-bg@2x.png` at build time or render time
2. Convert to base64 data URI
3. Embed in the slide master

If the logo PNG doesn't exist for dark bg, check: `apps/web/public/brand/png/logo/` and generate it or use the existing `basquio-logo-light-bg-mono.png` with color inversion.

### Also add the Basquio icon to the master footer

On `BASQUIO_MASTER`, add a small icon to the right of the footer text:

```typescript
// After the "Basquio | Confidential" text object:
{
  image: {
    x: 0.6,
    y: 7.15,
    w: 0.18,
    h: 0.18,
    data: BASQUIO_ICON_BASE64, // amber icon
  },
},
// Shift the text to x: 0.85 to make room for the icon
```

---

## Fix 3: Chart sizing — align prompt figsize with render placement (HIGH — chart design)

### Problem
The archetypes define prompt-facing figsize (e.g., `5.75x3.5"` for chart-split), but the renderer places charts at layout-regions coordinates (e.g., `12.133x4.55"` for title-chart). When Claude renders at the archetype size and the renderer stretches to fill the layout region, charts look blurry or misaligned.

Worse: for evidence-grid and table layouts, Claude sometimes renders charts at the WRONG archetype size, producing 283x175px thumbnails.

### Solution

**A. Increase DPI from 200 to 300 in system prompt examples**

In `packages/workflows/src/system-prompt.ts`, update ALL few-shot chart examples:

```
dpi=200  →  dpi=300
```

At 300 DPI, a 5.75"x3.5" chart = 1725x1050px — crisp at any scale.
At 200 DPI, same chart = 1150x700px — noticeable blur when scaled up.

**Research basis**: For LAYOUT_WIDE (13.333"x7.5") at Full-HD (1920x1080), the effective DPI is 144. Rendering at 300 DPI gives 2x oversampling — the standard for retina-quality output. 200 DPI only gives 1.4x which is visibly soft.

**B. Add explicit figsize validation in the system prompt**

Add to the system prompt deck-writing rules (after line ~537):

```
- CHART SIZE RULES:
  - title-chart layout: figsize=(9.25, 3.5), dpi=300
  - chart-split layout: figsize=(5.75, 3.5), dpi=300
  - evidence-grid layout: figsize=(5.75, 2.55), dpi=300
  - comparison layout: figsize=(4.55, 3.2), dpi=300
  - scenario-cards layout: figsize=(5.5, 3.5), dpi=300
  - NEVER render a chart smaller than figsize=(4, 2). Any chart below this threshold will be unreadable in the final PPTX.
  - ALWAYS check your figsize matches the layout you selected. A mismatch produces blurry or tiny charts.
```

**C. Add minimum chart size guard in render-v2.ts**

In `renderContentSlide()`, after placing the chart image, validate its pixel dimensions:

```typescript
// After reading the chart image buffer:
if (imgWidth < 800 || imgHeight < 400) {
  console.warn(`[render] Chart on slide ${slideIndex} is too small: ${imgWidth}x${imgHeight}px. Minimum is 800x400.`);
  // Scale up the figsize in the prompt for next iteration
}
```

This is advisory only — don't block the render, just log the warning so the visual QA judge can flag it.

---

## Fix 4: Layout variety enforcement (HIGH — from 5/10 to 8/10 layout)

### Problem
9/15 slides used `two-column` (which aliases to `chart-split`). The deck looks monotonous.

### Solution

**A. Add layout diversity rule to system prompt**

In `packages/workflows/src/system-prompt.ts`, add to the deck-writing rules:

```
- LAYOUT VARIETY RULE:
  - A 10-slide deck MUST use at least 4 different layout types.
  - A 15-slide deck MUST use at least 5 different layout types.
  - No single layout type may exceed 40% of total slides (e.g., max 6 out of 15).
  - Recommended layout mix for a 15-slide deck:
    - 1 cover
    - 1 exec-summary
    - 2-3 title-chart (full-width chart for key data)
    - 2-3 chart-split (chart + text side-by-side)
    - 1-2 evidence-grid (metrics + chart)
    - 1-2 recommendation-cards or key-findings
    - 1 summary
  - If you find yourself using chart-split more than 5 times, convert some to title-chart (full-width) or evidence-grid.
```

**B. Add layout diversity check to the lint phase**

The lint already flags `>50% of slides use "two-column"`. Upgrade this from advisory to **actionable**:

In the lint code (wherever `actionableIssues` is built), change the threshold:
- Current: warns at >50% same layout
- New: warns at >40% same layout, and the revise prompt should reference this as a specific fix target

**C. Add a layout audit to the visual QA prompt**

In `packages/workflows/src/rendered-page-qa.ts`, add to the critique criteria:

```
- Layout variety: Does the deck use at least 4 different layout types? Or does it feel like the same slide repeated?
```

---

## Fix 5: Schema validation hardening (MEDIUM — reliability)

### Problem
50+ Zod errors on analysis_result.json. Fields like `chart.id`, `chartType`, `title`, `figureSize` all wrong. The system salvaged from manifest, but this is fragile.

### Solution

**A. Use `.passthrough()` on ALL Zod objects that receive LLM output**

Per CLAUDE.md rule: "Use `.passthrough()` on Zod objects for LLM output."

Verify every schema in `packages/types/` that parses Claude's output uses `.passthrough()`.

**B. Add coercion for common type mismatches**

In the analysis_result parser, add:
```typescript
// figureSize: accept both [w, h] arrays and {w, h} objects
figureSize: z.union([
  z.object({ w: z.number(), h: z.number() }),
  z.tuple([z.number(), z.number()]).transform(([w, h]) => ({ w, h })),
]).optional(),

// slotAspectRatio: accept both number and string
slotAspectRatio: z.union([z.number(), z.string().transform(Number)]).optional(),

// sort: accept "value" as "desc" (common Claude mistake)
sort: z.enum(["desc", "asc", "none"]).catch("desc"),

// id, chartType, title: provide defaults instead of requiring
id: z.string().default(() => `chart-${crypto.randomUUID().slice(0, 8)}`),
chartType: z.string().default("bar"),
title: z.string().default(""),
```

**C. Remove the `.strict()` calls if any exist on LLM-facing schemas**

---

## Fix 6: Chart design polish (MEDIUM — from 5/10 to 8/10 chart design)

### Problem
- Data labels overlap on market share bar chart (slide 4: "37.0%(2.5%)" collision)
- Legend boxes have semi-transparent backgrounds bleeding into chart area
- No consistent visual hierarchy (all bars same weight, no emphasis on key insight)

### Solution

**A. Add matplotlib styling rules to system prompt**

Add to the chart examples section:

```python
# CHART STYLING RULES (add to every matplotlib chart):
# 1. NEVER put two pieces of data in the same label. Use separate annotations.
# 2. Legend: use frameon=False, position outside chart area (bbox_to_anchor=(1.02, 1))
# 3. Highlight the key insight bar with the accent color. Other bars use muted palette.
# 4. Grid: use alpha=0.15 for subtle gridlines on value axis only.
# 5. Spine: remove top and right spines. Left spine color = border token.
# 6. Font sizes: title 14pt, axis labels 11pt, tick labels 10pt, annotations 9pt.
# 7. Bar label padding: at least 8pt between label and bar edge.
# 8. For horizontal bars: ensure y-axis labels don't overlap bars. Use ha='right' with padding.
# 9. Source line: bottom-left, 8pt, muted color.
# 10. Save with bbox_inches='tight', pad_inches=0.15
```

**B. Add a chart-specific few-shot example showing label collision avoidance**

Add to `DECK_EXAMPLES` in system-prompt.ts:

```python
# GOOD: Separate share and growth into distinct visual elements
ax.barh(categories, shares, color=palette[0])
for i, (s, g) in enumerate(zip(shares, growths)):
    ax.text(s + 0.5, i, f'{s:.1f}%', va='center', fontsize=10, color=text_color)
    growth_color = positive_color if g > 0 else negative_color
    ax.text(s + 4, i, f'{"+" if g>0 else ""}{g:.1f}%', va='center', fontsize=9, color=growth_color)

# BAD: Cramming both into one label
# ax.text(s, i, f'{s:.1f}%({g:+.1f}%)')  ← NEVER DO THIS
```

**C. Add highlight-the-insight rule**

```
- CHART EMPHASIS RULE:
  - Every chart must have ONE visually highlighted element — the bar, segment, or line that carries the slide's key insight.
  - Use the accent color (amber) for the highlighted element.
  - Use muted palette colors for all other elements.
  - This creates instant visual hierarchy: the reader's eye goes to the insight first.
```

---

## Fix 7: Matplotlib dark theme consistency (LOW — polish)

### Problem
Charts on dark background use inconsistent styling. Some have transparent legend boxes, some have visible gridlines, tick label colors vary.

### Solution

Add a mandatory matplotlib theme preamble to the system prompt:

```python
# BASQUIO DARK THEME PREAMBLE — paste this at the top of every chart script:
import matplotlib.pyplot as plt
import matplotlib as mpl

BG = '#0A090D'
SURFACE = '#13121A'
TEXT = '#F2F0EB'
MUTED = '#A09FA6'
DIM = '#6B6A72'
BORDER = '#272630'
ACCENT = '#F0CC27'
POSITIVE = '#4CC9A0'
NEGATIVE = '#E8636F'
PALETTE = ['#F0CC27', '#1A6AFF', '#4CC9A0', '#9B7AE0', '#E8636F', '#5AC4D4', '#6B7280', '#7ABBE0']

plt.rcParams.update({
    'figure.facecolor': BG,
    'axes.facecolor': BG,
    'text.color': TEXT,
    'axes.labelcolor': MUTED,
    'xtick.color': DIM,
    'ytick.color': DIM,
    'axes.edgecolor': BORDER,
    'grid.color': BORDER,
    'grid.alpha': 0.3,
    'legend.facecolor': 'none',
    'legend.edgecolor': 'none',
    'legend.labelcolor': MUTED,
    'font.family': 'Arial',
    'font.size': 11,
})
```

This replaces the ad-hoc per-chart styling with a consistent theme block.

---

## Implementation priority

| Fix | Impact | Effort | Priority |
|-----|--------|--------|----------|
| Fix 1: Brand colors | +2 branding | Low (find-replace) | P0 |
| Fix 2: Logo on cover | +1 branding | Medium (base64 embed) | P0 |
| Fix 4: Layout variety | +1.5 layout | Low (prompt change) | P1 |
| Fix 3: Chart sizing | +1 chart design | Medium (prompt + guard) | P1 |
| Fix 6: Chart design polish | +1 chart design | Medium (prompt examples) | P1 |
| Fix 5: Schema validation | +0.5 reliability | Medium (Zod refactor) | P2 |
| Fix 7: Dark theme consistency | +0.5 polish | Low (prompt preamble) | P2 |

**Expected improvement: 6.3/10 → 8.5-9.0/10**

The remaining gap to 10/10 requires:
- Real product video/animated demo on website (not just SVGs)
- Client template fidelity testing across PowerPoint/Slides/Keynote
- A/B testing of chart styles with real ICP users
- Multi-run regression suite (>10 runs scoring >8.5 before declaring 10)

---

## Files changed (summary)

| File | Changes |
|------|---------|
| `packages/render-pptx/src/render-v2.ts` | Fix SLATE/BOWER colors, add logo to cover master, add chart size guard |
| `packages/template-engine/src/index.ts` | Fix colors array and brandTokens in createSystemTemplateProfile() |
| `code/design-tokens.ts` | Fix BASQUIO_CHART_PALETTE and BASQUIO_COLORS |
| `packages/scene-graph/src/index.ts` | Fix default brand tokens fallback |
| `packages/workflows/src/system-prompt.ts` | DPI 200→300, layout variety rule, chart sizing rules, chart design rules, dark theme preamble, label collision example |
| `packages/workflows/src/rendered-page-qa.ts` | Add layout variety to critique criteria |
| `packages/types/src/*.ts` | .passthrough() on LLM-facing schemas, coercion for figureSize/sort/id |

---

---

## Compliance check against CLAUDE.md hard-won rules

Every fix in this spec was cross-checked against the CLAUDE.md rules. Below are the specific rules that apply and how the spec complies or was corrected:

### Rule: "Max 3 pipeline commits per day. Each commit validated with 1 production run before next commit."

**Compliance plan:** The 7 fixes in this spec MUST be shipped as max 3 commits:
- **Commit 1 (P0):** Fix 1 (brand colors across all 5 files) + Fix 2 (logo on cover). These are pure data changes — no logic changes, no new crash modes. Validate with 1 production Opus run.
- **Commit 2 (P1):** Fix 3 (DPI + figsize rules) + Fix 4 (layout variety rule) + Fix 6 (chart design examples) + Fix 7 (dark theme preamble). All prompt-only changes — system-prompt.ts only. Validate with 1 production Opus run.
- **Commit 3 (P2):** Fix 5 (schema coercion). Types/parsing changes only. Validate with 1 production run.

Each commit gets exactly 1 validation run before the next. No stacking untested commits.

### Rule: "Few-shot examples in the system prompt are the #1 quality lever."

**Compliance:** Fix 6 adds concrete few-shot examples (label collision avoidance, chart emphasis). Fix 7 adds a concrete theme preamble code block. These are EXAMPLES, not rules. This follows the proven March 30 pattern (fda7621).

### Rule: "The author prompt should have ~50 lines of instructions + 2-5 concrete examples, NOT 130 lines of rules with 0 examples."

**Risk flag:** Fix 3B adds chart size rules (7 lines), Fix 4A adds layout variety rules (8 lines), Fix 6C adds chart emphasis rule (4 lines). That's +19 lines of rules.

**Mitigation:** Each rule addition MUST be paired with or embedded inside a few-shot example. Do NOT add naked rules. The chart size rules should be inside a `<chart_sizing_example>` tag showing correct code. The layout variety rule should be inside a `<layout_variety_example>` tag showing a 15-slide layout plan. This keeps the prompt example-heavy, not rule-heavy.

### Rule: "Avoid over-prompting that causes overtriggering. 'CRITICAL: You MUST' language causes Claude 4.6 to overreact."

**Compliance check on spec language:**
- Fix 3B uses "NEVER render a chart smaller than..." — **REWRITE** to example form: "Charts below figsize=(4,2) become unreadable. Here's a good example: ..."
- Fix 4A uses "MUST use at least 4 different layout types" — **REWRITE** to example form: "A well-balanced 15-slide deck looks like: 1 cover, 1 exec-summary, 3 title-chart, ..."
- Fix 6A uses 10 numbered rules — **REWRITE** to a single annotated code example showing all 10 patterns in context.

### Rule: "NEVER add 'suppress output' or 'compact output' instructions that could cause Claude to skip file generation."

**Compliance:** None of the fixes add suppression instructions. Fix 7's matplotlib preamble is additive code, not suppression.

### Rule: "Per-slide spatial constraints (figsize, maxCategories, card geometry) from slot-archetypes MUST be included in the author message."

**Compliance:** Fix 3B makes the figsize-per-layout explicit in the prompt. This reinforces the existing slot-archetype system, doesn't replace it.

### Rule: "A run that spent $1+ MUST ship artifacts."

**Compliance:** Fix 3C's minimum chart size guard is ADVISORY ONLY (console.warn, not throw). Fix 5's schema coercion makes parsing more lenient, not stricter. Neither fix can block publish.

### Rule: "Publish gate: ONLY structural corruption blocks publish. Everything else is ADVISORY."

**Compliance:** Fix 4B upgrades the lint from advisory to "actionable" — but this means the REVISE phase will try to fix it, NOT that publish is blocked. The publish gate remains unchanged.

### Rule: "Budget caps: pre-flight $7.00, hard cap $10.00. DO NOT lower them."

**Compliance:** No fix changes budget caps. The DPI increase in Fix 3A may slightly increase code execution time (larger PNGs), but code execution compute is FREE (web_fetch in tools). No cost impact.

### Rule: "Anti-pattern: Adding 'hardening' commits that create new crash modes."

**Compliance check:**
- Fix 1 (colors): Pure value changes. Cannot crash.
- Fix 2 (logo): Adds an image to slide master. Could fail if base64 data is malformed. **Mitigation:** The implementation MUST test the base64 string in isolation before embedding. If the logo file doesn't exist, skip it gracefully (don't crash the render).
- Fix 3C (size guard): console.warn only. Cannot crash.
- Fix 4 (prompt rules): Prompt-only. Cannot crash.
- Fix 5 (schema): Makes parsing MORE lenient with `.catch()` and coercion. Reduces crash surface, doesn't add it.
- Fix 6-7 (prompt): Prompt-only. Cannot crash.

### Rule: "NEVER ship SDK type-level features without verifying the API actually accepts them."

**Compliance:** No fix changes the Anthropic API contract, tool types, or beta headers.

### Rule: "No 'fix' commit without identifying which prior commit introduced the regression."

**Root causes for this spec:**
- Wrong amber (`E8A84C`): Present since initial pipeline creation. Never aligned to brand system.
- No logo: Never implemented. BASQUIO_COVER master was always `objects: []`.
- Chart sizing: Archetype figsize vs layout-regions mismatch existed since scene-graph/layout-regions were created separately.
- Layout monotony: No variety rule ever existed in the system prompt.

These are NOT regressions — they are original gaps that were never addressed.

---

## Validation protocol

1. `pnpm qa:basquio` — type-check passes
2. Run 1 Opus deck with default template (Commit 1 validation), verify:
   - Cover slide has Basquio logo bottom-left
   - Amber accent is `#F0CC27` (not `#E8A84C`)
   - Chart lead color is `#F0CC27`
   - Footer "Basquio | Confidential" on every non-cover slide
   - No new crashes, no regressions vs baseline
3. Run 1 Opus deck (Commit 2 validation), verify:
   - All chart images are >=800px wide (no thumbnails)
   - At least 5 different layout types used in a 15-slide deck
   - Charts have highlight emphasis on key insight
   - No label collisions visible
   - Consistent dark theme styling across all charts
4. Run 1 Haiku deck to verify no regression on cheaper model
5. Open PPTX in Google Slides + Keynote, verify colors survive
6. Score each validation run on the 7-dimension rubric — target >=8.5/10
7. If any validation run scores <7.5, STOP and diagnose before next commit

## Research sources

- [PptxGenJS Images API](https://gitbrent.github.io/PptxGenJS/docs/api-images.html) — image sizing, contain/cover, data URIs
- [PptxGenJS Masters API](https://gitbrent.github.io/PptxGenJS/docs/masters/) — defineSlideMaster, objects, slideNumber
- [Anthropic PPTX Skill Reference](https://github.com/anthropics/skills/blob/main/skills/pptx/pptxgenjs.md) — PptxGenJS patterns in Claude code execution
- [Dark Mode Charts Best Practices 2026](https://www.cleanchart.app/blog/dark-mode-charts) — contrast ratios, semi-transparent fills, WCAG 2.1
- [Matplotlib High-Resolution Export](https://plotivy.app/blog/export-high-res-figures-matplotlib) — DPI settings, bbox_inches, vector vs raster
- [BCG Slide Breakdown](https://www.theanalystacademy.com/bcg-slide-breakdown/) — layout variety, action titles, chart emphasis
- [9 Proven PowerPoint Layout Structures](https://deckary.com/blog/powerpoint-layout-ideas) — archetype patterns, layout mix
- [McKinsey Presentation Structure](https://slidemodel.com/mckinsey-presentation-structure/) — pyramid principle, MECE, visual hierarchy
- [AI Presentation Quality Scoring Rubric](https://plusai.com/blog/presentation-scoring-rubric) — multi-dimensional evaluation framework
