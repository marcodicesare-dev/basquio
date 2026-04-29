# Basquio Variant J SVG Illustration System

Date: 2026-04-29
Branch: `codex/marketing-variant-j-claude-rebuild`

## Current State

The homepage now uses authored SVG illustrations below the atmospheric hero.

Section anchors:

- Product: `/marketing/illustrations/product-anchor.svg`
- Workspace: `/marketing/illustrations/workspace-anchor.svg`
- About: `/marketing/illustrations/about-anchor.svg`
- Security: `/marketing/illustrations/security-anchor.svg`

Workspace spots:

- Client: `/marketing/illustrations/memory-spot-client.svg`
- Brand: `/marketing/illustrations/memory-spot-brand.svg`
- Template: `/marketing/illustrations/memory-spot-template.svg`
- Last meeting: `/marketing/illustrations/memory-spot-meeting.svg`
- Past reviews: `/marketing/illustrations/memory-spot-reviews.svg`
- Approved formats: `/marketing/illustrations/memory-spot-formats.svg`

## Style Contract

- Warm cream canvas: `#F8F5EF`
- Primary line: Basquio ultramarine `#1A6AFF`
- One amber accent per illustration: `#F0CC27`
- Shadow only: near-black `#0B0C0C` at low opacity
- Uniform 1.5px stroke
- No readable text in the image
- Live copy remains HTML/CSS

## Integration Points

- `apps/web/src/app/page.tsx` swaps the section anchors and renders the six Workspace spots.
- `apps/web/src/app/global.css` adds `section-j-anchor-illustration`, `memory-list-illustrated`, and `memory-spot-illustration`.
- The hero remains photographic/atmospheric and uses `/marketing/hero-candidates/basquio-memory-context-01.jpg`.

## Iteration Guidance

If generating cleaner assets with GPT Image 2 or Recraft V4, preserve the filenames above so the integration does not need to change. Replace only assets whose composition is weaker than the current SVG, then rerun:

```bash
pnpm --filter @basquio/web build
pnpm qa:basquio
```

