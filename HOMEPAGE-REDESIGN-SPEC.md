# Basquio Homepage Redesign — Implementation Spec

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
