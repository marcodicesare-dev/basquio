---
name: basquio-foundation
description: >
  Use when scaffolding Basquio, changing architecture, setting repo standards,
  designing workflow/database boundaries, defining evidence-package and brand-input contracts,
  or updating canonical contracts.
---

# Basquio Foundation

## Goal

Keep the product context coherent before code branches into implementation details.

Basquio is not a generic deck generator. It is a report-generation system for structured evidence packages plus a briefing input and a brand input.

## Required Reads

1. `docs/vision.md`
2. `docs/architecture.md`
3. `memory/canonical-memory.md`
4. `rules/canonical-rules.md`
5. `docs/stack-practices.md` when stack behavior may influence the implementation

## Workflow

1. Confirm the change matches the intelligence-first product thesis.
2. Confirm the change strengthens evidence-package understanding, report quality, or brand-controlled rendering.
3. Update architecture before implementation if the decision is structural.
4. Update decision log and memory in the same change.
5. Update `code/contracts.ts` if any planning or brand-input contract changes.
6. Run `pnpm qa:basquio`.
7. If the change touches runtime persistence or job status, confirm QA covers schema compatibility and stale-run recovery rather than only docs presence.

## Refuse To Do

- add architecture drift without updating memory
- let workflow or charting decisions bypass canonical rules
- turn preview UI choices into contract definitions
