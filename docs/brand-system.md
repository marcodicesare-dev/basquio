# Basquio Brand System

Source of truth imported from the existing Basquio brand work under the local `.context` workspace.

## Identity

- Product: `basquio.com`
- Icon: minimal three-peak crown inspired by Basquiat's 1982 crown motif
- Wordmark casing: always `basquio` in lowercase for lockups
- Wordmark font: `Satoshi 700` with tight tracking

## Palette

- Onyx: `#0B0C0C`
- White: `#FFFFFF`
- Amber: `#F0CC27`
- Ultramarine: `#1A6AFF`
- Slate: `#6B7280`

## Logo Rules

- Dark background primary lockup: amber crown plus white wordmark
- Light background default lockup: onyx crown plus onyx wordmark
- Light background alternate lockup: ultramarine crown plus onyx wordmark
- Crown stays filled. Do not rotate, stretch, outline, or restyle it.

## Asset Location

Canonical web-ready assets now live in:

- `apps/web/public/brand/svg/`
- `apps/web/public/brand/png/`

## Available Assets

- locked wordmarks: dark, light mono, light blue
- crown icons: onyx, white, amber, ultramarine
- circle icons: onyx, white
- favicon SVG plus PNG sizes

## Technical Notes

- SVG wordmarks rely on `Satoshi` font loading for browser-perfect rendering
- PNG wordmarks were pre-rendered in the original asset pipeline and are safer for contexts that cannot load the web font
- if Basquio later needs Open Graph or app-icon setup, prefer the delivered PNGs instead of re-exporting from scratch

## Product UI Application Rules

- Basquio should default to a light product canvas with editorial spacing and calm surfaces.
- dark surfaces are allowed for technical-stage moments such as pipeline explanation, generation state, and proof framing, but Basquio must not become a dark-mode-only brand.
- ultramarine is the primary UI accent for action and navigation emphasis.
- amber should stay sparse and directional: logo moments, proof labels, stage emphasis, and selective calls to attention.
- on light surfaces, prefer the onyx or ultramarine lockups; on dark surfaces, use the dark-background lockup.
- do not replace the crown or wordmark with text-only branding in the app shell or landing page when canonical assets are available.
