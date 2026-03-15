---
name: basquio-stack-context
description: >
  Use when changing Supabase, Inngest, Browserless, ECharts, SheetJS,
  PptxGenJS, pptx-automizer, or brand-token intake behavior, or when future agents need official
  stack guidance before implementation.
---

# Basquio Stack Context

## Goal

Prevent stack-level mistakes that do not violate TypeScript but do violate operational reality.

## Required Reads

1. `docs/architecture.md`
2. `docs/stack-practices.md`
3. `rules/canonical-rules.md`

## Apply This Skill For

- Supabase schema, storage, or auth-boundary changes
- Inngest workflow behavior, retries, or idempotency
- Browserless PDF rendering changes
- ECharts export decisions
- SheetJS ingest behavior
- design-token file intake and normalization
- PptxGenJS or `pptx-automizer` integration work

## Execution Rules

- prefer primary-source docs for library behavior
- separate preview concerns from export concerns
- keep service-role usage server-only
- keep Inngest step IDs stable once runs may exist in production
- use signed URLs for private artifact delivery
- fail early on unsupported workbook/template inputs instead of retrying forever
- verify Supabase REST `select` fields against the migration-defined schema before shipping
- when prod and local disagree, inspect exported app logs and database logs before trusting the progress UI

## Refuse To Do

- expose generated artifacts through public buckets by accident
- mix user-scoped SSR clients with service-role administration
- choose charting approaches based on preview convenience alone
- add workflow retries without considering idempotency
