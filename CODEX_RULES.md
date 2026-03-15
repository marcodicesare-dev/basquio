# Codex Rules

## Purpose

These rules keep Basquio build work aligned with the canonical product context.

## Mandatory Read Order

1. `docs/vision.md`
2. `docs/architecture.md`
3. `memory/canonical-memory.md`
4. `rules/canonical-rules.md`
5. `docs/stack-practices.md` before changing workflow, ingest, rendering, or brand-token handling
6. `docs/brand-system.md` before changing design-system or styling inputs

## Mandatory Update Set

If a structural decision changes, update all relevant files in the same change:

- `docs/architecture.md`
- `docs/decision-log.md`
- `memory/canonical-memory.md`
- `rules/canonical-rules.md`
- `code/contracts.ts`

## Implementation Priorities

- protect the intelligence layer first
- protect evidence-package understanding and brand-controlled rendering as part of the product contract
- keep renderer choices subordinate to contracts
- prefer honest constraints to overpromised fidelity
- make QA cheap and mandatory

## QA

Run:

```bash
pnpm qa:basquio
```

`pnpm qa:basquio` is not only a docs-presence check. It must be kept schema-aware for Supabase-backed runtime reads and writes so code cannot select columns that the migrations do not create.

Recommended before code merge:

```bash
pnpm typecheck:fast
pnpm lint:fast
```

When production incidents appear, exported web logs and database logs are first-class debugging inputs and should be checked before assuming the UI accurately reflects runtime state.
