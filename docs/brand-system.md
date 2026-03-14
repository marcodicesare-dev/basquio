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

- `Basquio/apps/web/public/brand/svg/`
- `Basquio/apps/web/public/brand/png/`

## Available Assets

- locked wordmarks: dark, light mono, light blue
- crown icons: onyx, white, amber, ultramarine
- circle icons: onyx, white
- favicon SVG plus PNG sizes

## Technical Notes

- SVG wordmarks rely on `Satoshi` font loading for browser-perfect rendering
- PNG wordmarks were pre-rendered in the original asset pipeline and are safer for contexts that cannot load the web font
- if Basquio later needs Open Graph or app-icon setup, prefer the delivered PNGs instead of re-exporting from scratch
