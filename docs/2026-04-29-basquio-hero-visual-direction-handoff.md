# Basquio Hero Visual Direction Handoff

Date: 2026-04-29
Branch: `codex/marketing-variant-j-claude-rebuild`

## Direction

Use the Planhat-level atmospheric language, but make it Basquio-owned:

- warm human darkness
- textured glass, shadow, depth, and plants
- abstract memory/context layers behind the glass
- analyst craft: fragments becoming insight
- AI as quiet assistance, not robots, holograms, or blue sci-fi
- no literal software screenshots, dashboards, laptops, decks, pens, or desk still lifes

Readable product meaning must stay in live HTML/CSS. The image is only the visual layer.

## Current Preview Default

The homepage hero currently points to:

`/marketing/hero-candidates/basquio-memory-context-01.jpg`

Implementation file:

`apps/web/src/components/marketing-hero-j.tsx`

To test another option, replace the `Image` `src` with one of the candidate paths below.

## Candidate Assets

Contact sheet:

`apps/web/public/marketing/hero-candidates/basquio-memory-context-contact-sheet.jpg`

Individual candidates:

1. `apps/web/public/marketing/hero-candidates/basquio-memory-context-01.jpg`
2. `apps/web/public/marketing/hero-candidates/basquio-memory-context-02.jpg`
3. `apps/web/public/marketing/hero-candidates/basquio-memory-context-03.jpg`
4. `apps/web/public/marketing/hero-candidates/basquio-memory-context-04.jpg`
5. `apps/web/public/marketing/hero-candidates/basquio-memory-context-05.jpg`
6. `apps/web/public/marketing/hero-candidates/basquio-memory-context-06.jpg`
7. `apps/web/public/marketing/hero-candidates/basquio-memory-context-07.jpg`
8. `apps/web/public/marketing/hero-candidates/basquio-memory-context-08.jpg`
9. `apps/web/public/marketing/hero-candidates/basquio-memory-context-09.jpg`
10. `apps/web/public/marketing/hero-candidates/basquio-memory-context-10.jpg`

Initial read:

- Strongest thematic direction: 01, 02, 03
- Most human-crafted: 04
- Most "living workspace memory": 08, 10
- Most output-assembly literal: 07

## Prompt Pattern

Use this structure for more variants:

```text
Use case: photorealistic-natural
Asset type: Basquio homepage hero candidate, 16:9 atmospheric visual, no readable text.
Primary request: Planhat-style atmospheric enterprise brand photography, but Basquio-owned and thematically about memory, analyst judgment, context assembly, insight, and human-crafted AI output. Warm, human, cinematic, minimal, premium.
Scene/backdrop: smoked or frosted architectural glass with warm amber light behind it. Behind the glass, show blank translucent research cards, vellum layers, archive shapes, or soft sheet silhouettes being organized. Add organic plant shadows for warmth. Everything should be abstract and out of focus enough that it reads as memory/context, not as a literal board.
Subject: research memory and analyst craft; fragments becoming insight; context becoming output; AI as quiet background intelligence, not visible technology.
Composition: full-bleed hero image with a dark copy-safe zone on the left, warm layered activity center-right, natural lens grain, depth, and premium design-agency photography. Avoid copying Planhat's exact crop.
Palette: Basquio onyx #0B0C0C, graphite #181B1C, warm amber #C88943, ivory vellum glow #E8D2A4, olive shadow #2D3828, tiny ultramarine reflection #1A6AFF.
Hard constraints: NO readable text, NO logos, NO screens, NO laptops, NO dashboards, NO charts, NO UI, NO sci-fi, NO neon, NO watermark.
Negative prompt: fake SaaS dashboard, desk still life, legible notes, pseudo letters, product screenshot, cold cyberpunk, glossy CGI, exact Planhat copy.
```

## Integration Instructions

1. Pick a candidate path.
2. In `apps/web/src/components/marketing-hero-j.tsx`, update the `Image` `src`.
3. Keep all readable copy in JSX. Do not ask the image model to render text.
4. Keep the CSS hero overlay in `apps/web/src/app/global.css`; tune `object-position`, scrim strength, and mobile crop only if the chosen image needs it.
5. Validate:

```bash
pnpm --filter @basquio/web build
pnpm qa:basquio
```

6. Browser-check desktop and mobile:

```bash
pnpm dev --hostname 127.0.0.1 --port 3000
```

Capture at least:

- desktop `1440x900`
- mobile `390x844`

7. Push the branch and wait for the Vercel branch preview:

`https://basquio-web-git-codex-marketing-variant-j-claude-rebuild-loamly.vercel.app/`

## Do Not Regress

- Do not return to deck screenshots, laptop mockups, fake dashboards, or literal analytics UI.
- Do not use exact Planhat crop logic: black left wall plus simple right ribbed plant image is too close.
- Do not put generated text in the image.
- Do not make the hero cold, blue, sci-fi, holographic, or robot-coded.
- Do not make it beige desert / Dune-like.

