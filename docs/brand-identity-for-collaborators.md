# Basquio — Brand Identity & Design Tokens

For: external collaborators (video, motion, design)
Verified against: `apps/web/src/app/global.css`, `code/design-tokens.ts`, `packages/template-engine/src/index.ts`, `docs/brand-system.md`, `apps/web/public/brand/`
Last updated: 2026-04-17

---

## 1. Identity

- **Product:** Basquio (always lowercase in wordmark — `basquio`)
- **Domain:** basquio.com
- **Tagline:** "Beautiful Intelligence."
- **Icon:** minimal three-peak crown inspired by Basquiat's 1982 crown motif. Stays filled. Do not rotate, stretch, outline, or restyle it.
- **Wordmark font:** Satoshi 700, tight tracking
  - Note: SVG wordmarks rely on Satoshi being loaded; PNG wordmarks are pre-rendered and safer when Satoshi isn't available
- **Tone:** confident, editorial, evidence-led. *The Economist* meets a top-tier strategy consultancy. Never SaaS-cheerful, never crypto-flashy.

---

## 2. Color palette

### Core brand
| Name | Hex | Usage |
|------|-----|-------|
| Onyx | `#0B0C0C` | Primary text, dark backgrounds |
| White | `#FFFFFF` | Backgrounds, inverse text |
| Amber | `#F0CC27` | Brand highlight, sparing accent, chart lead |
| Ultramarine | `#1A6AFF` | Primary CTA, links, primary UI accent |
| Slate | `#6B7280` | Muted text, secondary UI |

### Web surfaces (the warm cream Basquio look)
| Token (CSS var) | Hex | Usage |
|---|---|---|
| `--canvas` | `#F5F1E8` | Default page background (warm cream) |
| `--canvas-2` | `#EFE8DC` | Deeper cream for contrast |
| `--canvas-stage` | `#F8F5EF` | Panel/card stage background |
| `--surface-solid` | `#FFFFFF` | Opaque card surface |
| `--surface-dark` | `#0B0C0C` | Dark panel background |
| `--text` | `#0B0C0C` | Primary text |
| `--text-muted` | `#5D656B` | Caption/muted text |
| `--border` | `rgba(11,12,12,0.10)` | Default border |

The body has a subtle radial wash: amber glow top-left + ultramarine glow top-right, fading into a `#F8F5EF → #F2ECDF` vertical gradient with a faint 40px grid (opacity 0.2). Replicate this if you're matching the site exactly.

### Status accents (use sparingly)
| Name | Hex | Usage |
|------|-----|-------|
| Positive | `#4CC9A0` | Growth, success |
| Negative | `#E8636F` | Decline, error |

### Chart palette (8 colors, ordered by usage priority)
```
#F0CC27   Amber (lead)
#1A6AFF   Ultramarine
#4CC9A0   Green
#9B7AE0   Purple
#E8636F   Red
#5AC4D4   Cyan
#6B7280   Slate
#7ABBE0   Light blue
```
Always lead with Amber, then Ultramarine. Other colors only when the data requires them.

---

## 3. Typography

### Marketing site & product UI
| Context | Font | Notes |
|---------|------|-------|
| Body | **Manrope** | loaded via Next.js / Google Fonts as `--font-manrope` |
| Mono | **JetBrains Mono** | loaded as `--font-jetbrains-mono` |
| Wordmark | **Satoshi 700** | tight tracking; only inside the logo lockup |

### Decks (PPTX output)
| Context | Font |
|---------|------|
| Headings | **Arial** |
| Body | **Arial** |
| Mono | **Courier New** |

System fonts in decks is intentional — embedded fonts break PPTX rendering across PowerPoint, Keynote, and Google Slides.

---

## 4. Logo lockups

### Files (in repo: `apps/web/public/brand/`)
**SVG wordmarks (full lockup: crown + "basquio")**
- `svg/logo/basquio-logo-light-bg-blue.svg` — ultramarine crown + onyx wordmark (light bg default)
- `svg/logo/basquio-logo-light-bg-mono.svg` — onyx crown + onyx wordmark (light bg, quieter)
- `svg/logo/basquio-logo-dark-bg.svg` — amber crown + white wordmark (dark bg primary)

**SVG crown-only icons**
- `svg/icon/basquio-icon-onyx.svg`
- `svg/icon/basquio-icon-ultramarine.svg`
- `svg/icon/basquio-icon-amber.svg`
- `svg/icon/basquio-icon-white.svg`

**SVG circle marks (crown inside circle)**
- `svg/circle/basquio-circle-onyx.svg`
- `svg/circle/basquio-circle-white.svg`

**PNG raster (1x / 2x / 4x — same three lockups)**
- `png/logo/{1x,2x,4x}/basquio-logo-light-bg-blue[@2x|@4x].png`
- `png/logo/{1x,2x,4x}/basquio-logo-light-bg-mono[@2x|@4x].png`
- `png/logo/{1x,2x,4x}/basquio-logo-dark-bg[@2x|@4x].png`
- `png/circle/{1x,2x,4x}/basquio-circle-onyx[@2x|@4x].png`
- `png/circle/{1x,2x,4x}/basquio-circle-white[@2x|@4x].png`

### Rules
- On warm cream / white → **light-bg-blue** lockup (ultramarine crown + onyx wordmark)
- On Onyx / dark → **dark-bg** lockup (amber crown + white wordmark)
- Use the **light-bg-mono** lockup only when a quieter treatment is explicitly needed
- Crown stays filled. Don't rotate, outline, recolor, or restyle it.
- Don't put the lockup on busy photography without a solid card behind it
- Clear space around the lockup ≥ height of the "b" glyph
- Never replace the crown + wordmark with text-only branding when canonical assets exist

---

## 5. Visual style — marketing site & product

- **Default canvas:** warm cream (`#F5F1E8`), not stark white. This is the brand's most recognizable visual signature.
- **Cards:** translucent white (`rgba(255,255,255,0.82)`) with `backdrop-filter: blur(18px)` over the cream + soft shadow `0 2px 8px rgba(11,12,12,0.04)`
- **Radius:** 4–8px (small 4, button 6, card 8, pill 4)
- **Section rhythm:** 80px between landing sections, 32px section-level stack, 18px stack-lg, 12px default stack
- **Page max width:** 1440px with 32px gutter
- **Editorial feel:** large type, generous negative space, sparing color, single Amber accent per view
- **Dark surfaces** are allowed for technical-stage moments (pipeline explanation, generation state, proof framing) — but Basquio is *not* a dark-mode-only brand

### Shadows
| Token | Value |
|-------|-------|
| `--shadow-soft` | `0 2px 8px rgba(11,12,12,0.04)` |
| `--shadow-panel` | `0 4px 16px rgba(11,12,12,0.06)` |
| `--shadow-stage` | `0 8px 32px rgba(11,12,12,0.08)` |

---

## 6. Visual style — deck template ("Basquio Standard")

The default deck output is a **warm light editorial** look. Source: `packages/template-engine/src/index.ts → createSystemTemplateProfile()`.

| Aspect | Value |
|--------|-------|
| Slide size | 16:9, 13.333" × 7.5" (LAYOUT_WIDE) |
| Background | `#F5F1E8` (warm cream) |
| Surface (cards) | `#FBF8F1` (tonal ivory) |
| Border | `#D6D1C4` |
| Ink (text) | `#0B0C0C` |
| Muted text | `#5D656B` |
| Primary accent | `#1A6AFF` (ultramarine) |
| Highlight (sparse) | `#F0CC27` (amber) |
| Positive / negative | `#4CC9A0` / `#E8636F` |
| Page margin | 0.6" × 0.5" |
| Section gap | 0.32" |
| Block gap | 0.2" |
| Card radius | 0.06" |
| Title size | 24pt |
| Body size | 12pt |

### Slide chrome
- **Cover slide:** large Arial title on cream, "Made with Basquio" + ultramarine logo top-right
- **Content slides:** small Basquio logo top-right, slide number bottom-right
- **Charts:** dark-on-cream, single highlight color, small muted source line at bottom
- When a *client* template is provided, Basquio chrome is removed entirely (no "Basquio" in footers/watermarks)

### Alternate deck templates (for visual range in video)
| Name | Style | Background | Accent |
|------|-------|-----------|--------|
| **Slate** | Premium dark editorial | `#0A090D` | `#F0CC27` (amber) |
| **Bower** | MBB consulting classic | `#FFFFFF` | `#0B0C0C` (onyx) |
| **Signal** | Data-heavy analyst | `#FFFFFF` | `#7C3AED` (violet) |
| **Verso** | Bold modern / VC pitch | `#FFFFFF` | `#E11D48` (rose) |

For a video, **Basquio Standard (cream)** + **Slate (dark)** pair best — they show the brand's range without diluting identity.

---

## 7. Email templates

| Element | Value |
|---------|-------|
| Background | `#F5F1E8` (canvas) |
| Card | `#FFFFFF` |
| Text | `#0B0C0C` |
| CTA button | `#1A6AFF` |
| Muted text | `#5D656B` |
| Font stack | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` |
| Tagline line | "Beautiful Intelligence." |
| Logo (raster) | `/brand/png/logo/2x/basquio-logo-light-bg-blue@2x.png` |

---

## 8. Quick "do / don't" for video

**Do**
- Lean into warm cream backgrounds (`#F5F1E8`) — that's *the* Basquio look
- Use Amber as a single accent per shot, not as a fill
- Use Manrope for any motion type / lower thirds; Satoshi for the wordmark only
- Keep transitions minimal and editorial — fades, slow pushes, no swooshes
- Pair the dark variant (`#0A090D` + amber) for contrast moments
- Show the crown filled and unrotated

**Don't**
- Don't put the logo on stark white as the default — use cream
- Don't recolor or outline the crown or wordmark
- Don't use rainbow chart palettes — lead with amber/ultramarine
- Don't add SaaS gradients, glows, bevels, or 3D effects
- Don't use any font outside Manrope/JetBrains Mono (motion) or Arial/Courier New (decks)
- Don't write "Basquio" anywhere in the deck chrome when a client template is in use

---

## 9. Asset starter kit to send

Pull these from the repo (`apps/web/public/brand/`):

1. `svg/logo/basquio-logo-light-bg-blue.svg` (default lockup)
2. `svg/logo/basquio-logo-dark-bg.svg` (dark lockup)
3. `svg/logo/basquio-logo-light-bg-mono.svg` (quiet lockup)
4. `svg/icon/basquio-icon-ultramarine.svg`
5. `svg/icon/basquio-icon-amber.svg`
6. `svg/icon/basquio-icon-onyx.svg`
7. `png/logo/4x/basquio-logo-light-bg-blue@4x.png` (high-res raster for video)
8. `png/logo/4x/basquio-logo-dark-bg@4x.png`
9. Manrope font family — https://fonts.google.com/specimen/Manrope
10. Satoshi 700 — only if rendering the wordmark fresh (otherwise use the PNG/SVG directly)
11. A sample deck PDF for the on-screen "deck" beat

---

## 10. Where this lives in code (so the friend / future-you can verify)

- Web CSS variables → `apps/web/src/app/global.css`
- Web font loading → `apps/web/src/app/layout.tsx` (Manrope + JetBrains Mono via `next/font/google`)
- Shared chart palette + token export → `code/design-tokens.ts`
- Pipeline / deck profile → `packages/template-engine/src/index.ts → createSystemTemplateProfile()`
- Brand rules → `docs/brand-system.md`
- Full token reference → `docs/design-tokens.md`
- Brand assets → `apps/web/public/brand/{svg,png}/`
