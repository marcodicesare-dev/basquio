# Design Synthesis

This document distills the useful visual patterns from CostFigure and Inngest into a Basquio-specific direction.

The point is not to clone either product. The point is to identify reusable structure:

- CostFigure contributes editorial clarity, spacing discipline, and token governance
- Inngest contributes technical confidence, dark-stage drama, and product-proofs framing

## CostFigure Patterns Worth Borrowing

Derived from local code and docs in the CostFigure repo:

- a canonical token file in `globals.css` with explicit palette, text scales, and reusable component classes
- a restrained editorial tone with one dominant accent, one support accent, and quiet neutrals
- sticky navigation with a light translucent shell instead of a loud app bar
- consistent section labels and divider treatments to make pages feel systemized
- wordmark/logo assets stored canonically in `public/logo/`
- strong documentation around site brand rules and UI constraints

Basquio takeaway:

- Basquio should define a real token system, not scatter colors across components
- presentation and report workflows should feel editorial and premium, not dashboard-generic
- brand assets belong in a canonical app path, not buried in external context folders

## Inngest Patterns Worth Borrowing

Derived from the imported homepage source in `/Users/marcodicesare/Downloads/inngest-home-page.txt`:

- dark canvas plus subtle grid/noise background for technical credibility
- prominent proof-driven hero with one bold promise and two clean CTAs
- code-window framing to explain a complex technical product concretely
- strong trust row with customer logos near the hero
- dark/light contrast used intentionally instead of flat monochrome sections
- amber accent used sparingly to direct action

Basquio takeaway:

- Basquio can use a darker, sharper hero language for the product shell or marketing page
- workflow and generation steps should be visualized explicitly, not hidden behind vague copy
- a future landing page should show the pipeline from dataset to story to artifacts in one glance

## Basquio Design Direction

Recommended merged direction:

- base canvas: near-white or very pale stone for the app shell
- primary text: onyx
- primary CTA / key accent: ultramarine
- highlight accent: amber, used sparingly for logo, proof, and emphasis
- typography: geometric sans with more character than default system UI
- containers: wide, editorial, and calm rather than compressed SaaS cards
- technical surfaces: when showing workflow steps or generation state, use darker panels inspired by Inngest's code surfaces

## Do Not Borrow

- CostFigure's terracotta-led consumer warmth as the main Basquio accent
- Inngest's exact black/orange brand treatment
- preview-layer charting styles from any current site as Basquio's export contract

## Immediate Product UI Priorities

1. Replace placeholder text-only branding in the Basquio app shell with the canonical Basquio mark.
2. Add a first-class job creation flow with a premium, presentation-oriented layout.
3. Show the generation pipeline visually so users understand parse, analyze, insight, story, slide, and render stages.
4. Add artifact cards that make PPTX and PDF outputs feel like real deliverables instead of generic files.
