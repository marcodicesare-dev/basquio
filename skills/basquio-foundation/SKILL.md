---
name: basquio-foundation
description: >
  Use when scaffolding Basquio, changing architecture, setting repo standards,
  designing workflow/database boundaries, or updating canonical contracts.
---

# Basquio Foundation

## Goal

Keep the product context coherent before code branches into implementation details.

## Required Reads

1. `Basquio/docs/vision.md`
2. `Basquio/docs/architecture.md`
3. `Basquio/memory/canonical-memory.md`
4. `Basquio/rules/canonical-rules.md`

## Workflow

1. Confirm the change matches the intelligence-first product thesis.
2. Update architecture before implementation if the decision is structural.
3. Update decision log and memory in the same change.
4. Update `Basquio/code/contracts.ts` if any planning contract changes.
5. Run `pnpm qa:basquio`.

## Refuse To Do

- add architecture drift without updating memory
- let workflow or charting decisions bypass canonical rules
- turn preview UI choices into contract definitions
