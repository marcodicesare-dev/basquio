# Basquio Design Tokens

Single source of truth for all design decisions across web, pipeline, and email.

Last updated: 2026-04-02

---

## Brand Palette

| Name | Hex | Usage |
|------|-----|-------|
| Onyx | `#0B0C0C` | Primary text, dark backgrounds |
| White | `#FFFFFF` | Backgrounds, inverse text |
| Amber | `#F0CC27` | Brand accent (web), highlights |
| Ultramarine | `#1A6AFF` | Primary CTA, links, interactive elements |
| Slate | `#6B7280` | Muted text, secondary elements |

---

## Web Tokens (`global.css :root`)

### Colors — Light Theme (default)

| Token | Value | Usage |
|-------|-------|-------|
| `--canvas` | `#f5f1e8` | Page background (warm cream) |
| `--canvas-2` | `#efe8dc` | Deeper cream for contrast |
| `--canvas-stage` | `#f8f5ef` | Panel/card stage background |
| `--surface` | `rgba(255,255,255,0.82)` | Card/panel surface |
| `--surface-solid` | `#ffffff` | Opaque card surface |
| `--surface-muted` | `rgba(255,255,255,0.66)` | Subtle card surface |
| `--surface-strong` | `rgba(255,255,255,0.94)` | Strong card surface |
| `--surface-dark` | `#0b0c0c` | Dark panel background |
| `--surface-dark-2` | `#15181a` | Dark panel secondary |
| `--surface-dark-3` | `#202427` | Dark panel tertiary |

### Colors — Text

| Token | Value | Usage |
|-------|-------|-------|
| `--text` | `#0b0c0c` | Primary text |
| `--text-soft` | `rgba(11,12,12,0.72)` | Secondary text |
| `--text-muted` | `#5d656b` | Muted/caption text |
| `--text-inverse` | `#f4f6f8` | Text on dark panels |
| `--text-inverse-soft` | `rgba(244,246,248,0.88)` | Secondary text on dark panels |

### Colors — Accent

| Token | Value | Usage |
|-------|-------|-------|
| `--blue` | `#1a6aff` | Primary CTA, links |
| `--amber` | `#f0cc27` | Brand highlight, badges |
| `--amber-soft` | `rgba(240,204,39,0.16)` | Amber tint backgrounds |
| `--slate` | `#6b7280` | Neutral muted |

### Colors — Borders

| Token | Value | Usage |
|-------|-------|-------|
| `--border` | `rgba(11,12,12,0.1)` | Default border |
| `--border-strong` | `rgba(11,12,12,0.18)` | Emphasized border |
| `--border-inverse` | `rgba(255,255,255,0.12)` | Border on dark panels |

### Colors — Status

| Token | Value | Usage |
|-------|-------|-------|
| `--success` | `#edf7f1` | Success background tint |
| `--danger` | `#fff1ee` | Error background tint |

### Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-soft` | `0 2px 8px rgba(11,12,12,0.04)` | Subtle elevation |
| `--shadow-panel` | `0 4px 16px rgba(11,12,12,0.06)` | Panel elevation |
| `--shadow-stage` | `0 8px 32px rgba(11,12,12,0.08)` | Hero/stage elevation |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `4px` | Small elements (pills, chips) |
| `--radius-md` | `6px` | Buttons, inputs |
| `--radius-lg` | `8px` | Cards, panels |
| `--radius-pill` | `4px` | Pill-shaped elements |

### Typography

| Context | Font Stack |
|---------|-----------|
| Body | `var(--font-manrope)`, "Avenir Next", "Segoe UI", sans-serif |
| Mono | `var(--font-jetbrains-mono)`, "SFMono-Regular", monospace |
| Brand wordmark | Satoshi 700, letter-spacing: -0.06em |

### Spacing (non-variable, pattern-based)

| Pattern | Value | Usage |
|---------|-------|-------|
| `.stack` | gap: 12px | Default vertical spacing |
| `.stack-lg` | gap: 18px | Larger vertical spacing |
| `.stack-xl` | gap: 32px | Section-level vertical spacing |
| `.row` | gap: 12px | Horizontal button/element row |
| `.grid` | gap: 18px | Grid layouts |
| `.landing-shell` | gap: 80px | Between landing page sections |
| `.panel` | padding: 30px | Panel internal padding |
| `.site-wrap` | max-width: 1440px | Page content max width |

---

## Pipeline Tokens (PPTX/PDF generation)

### Why different from web

Pipeline output must use **universally-installed system fonts** for cross-platform PPTX compatibility (PowerPoint, Google Slides, Keynote). Web fonts (Manrope, JetBrains Mono) cannot be embedded in PPTX.

### House Template: "Slate" (system default for Basquio-branded output)

| Token | Value | Notes |
|-------|-------|-------|
| bg | `#0A090D` | Near-black |
| surface | `#13121A` | Card/panel bg |
| card | `#16151E` | Elevated card bg |
| border | `#272630` | Subtle borders |
| text (ink) | `#F2F0EB` | Primary text |
| muted | `#A09FA6` | Secondary text |
| dim | `#6B6A72` | Tertiary text |
| accent | `#F0CC27` | Brand amber |
| accentLight | `#1A1A12` | Amber tint bg |
| positive | `#4CC9A0` | Growth/success |
| negative | `#E8636F` | Decline/error |

### Pipeline Chart Palette (8 colors, ordered by usage priority)

```
#F0CC27  Amber (lead)
#1A6AFF  Ultramarine
#4CC9A0  Green
#9B7AE0  Purple
#E8636F  Red
#5AC4D4  Cyan
#6B7280  Slate
#7ABBE0  Light blue
```

### Pipeline Fonts

| Context | Font | Fallback |
|---------|------|----------|
| Headings | Arial | - |
| Body | Arial | - |
| Mono | Courier New | - |

### Pipeline Spacing

| Token | Value (inches) |
|-------|---------------|
| pageX margin | 0.6" |
| pageY margin | 0.5" |
| sectionGap | 0.32" |
| blockGap | 0.2" |
| cardRadius | 0.06" (Bower) / 0.12" (Slate) |

### PPTX Export Default: "Bower" (light theme for compatibility)

The actual PPTX export defaults to Bower (white background) because dark themes do not survive reliably across PowerPoint, Google Slides, and Keynote.

| Token | Value |
|-------|-------|
| bg | `#FFFFFF` |
| ink | `#0B0C0C` |
| accent | `#0B0C0C` (brand onyx) |
| coverBg | `#1F2937` |
| Chart lead | `#1A6AFF` (brand ultramarine) |

### All 5 House Templates

| Name | Style | Background | Accent | Use case |
|------|-------|-----------|--------|----------|
| Slate | Premium Dark Editorial | `#0A090D` | `#F0CC27` (brand amber) | Basquio-branded |
| Obsidian | Dark Executive | `#0F172A` | `#F59E0B` (amber 500) | Executive decks |
| Bower | MBB Consulting Classic | `#FFFFFF` | `#0B0C0C` (brand onyx) | Consulting (DEFAULT EXPORT) |
| Signal | Data-Heavy | `#FFFFFF` | `#7C3AED` (violet 600) | Analyst decks |
| Verso | Bold Modern / VC Pitch | `#FFFFFF` | `#E11D48` (rose 600) | Pitch decks |

---

## "Made by Basquio" Branding Rules

### When Basquio template is active (no client template):
- PPTX footer: `"Basquio | Confidential"` at x=0.6", y=7.15", fontSize 8, mono font, brand slate `#6B7280`
- PDF footer: same text, positioned bottom-left
- Logo: `/brand/svg/logo/basquio-logo-dark-bg.svg` (dark bg) or `/brand/svg/icon/basquio-icon-amber.svg`

### When client template IS provided:
- NEVER write "Basquio" in any slide footer, header, watermark, or confidentiality notice
- This is enforced in the system prompt (`system-prompt.ts` line 431)

---

## Known Discrepancies

| What | Web | Pipeline | Status |
|------|-----|----------|--------|
| Amber accent | `#F0CC27` | `#F0CC27` | Aligned |
| Background | `#f5f1e8` (warm cream) | `#0A090D` (Slate) / `#FFFFFF` (Bower) | **INTENTIONAL** — different contexts |
| Body font | Manrope | Arial | **INTENTIONAL** — PPTX requires system fonts |
| Mono font | JetBrains Mono | Courier New | **INTENTIONAL** — PPTX requires system fonts |
| Border radius | 4-8px | 0.06"-0.12" | Minor medium-specific variance; Basquio templates now keep rounded cards |
| Blue accent | `#1A6AFF` | `#1A6AFF` (Bower chart / fallback accent) | Aligned |

Remaining discrepancies are medium-driven, not brand drift: web and pipeline still differ on fonts and background treatment because PPTX compatibility and presentation contexts require it.

---

## Email Template Tokens

| Token | Value |
|-------|-------|
| Background | `#f5f1e8` (canvas) |
| Card | `#ffffff` |
| Text | `#0b0c0c` |
| CTA button | `#1a6aff` (ultramarine) |
| Muted text | `#5d656b` |
| Font stack | -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif |
| Tagline | "Beautiful Intelligence." |
| Logo | PNG from `/brand/png/logo/1x/basquio-logo-light-bg-mono.png` |

---

## Logo Assets

| Path | Variant |
|------|---------|
| `/brand/svg/logo/basquio-logo-light-bg-mono.svg` | Dark text on light bg |
| `/brand/svg/logo/basquio-logo-dark-bg.svg` | Light text on dark bg |
| `/brand/svg/icon/basquio-icon-onyx.svg` | Icon only, dark |
| `/brand/svg/icon/basquio-icon-amber.svg` | Icon only, amber |
| `/brand/png/circle/1x/basquio-circle-onyx.png` | Circle mark, dark |
| `/brand/png/logo/1x/basquio-logo-light-bg-mono.png` | Logo PNG for emails |
| `/brand/png/logo/2x/basquio-logo-light-bg-mono@2x.png` | Logo PNG 2x retina |
