# Codex Rules

## Purpose

These rules keep Basquio build work aligned with the canonical product context.

## Mandatory Read Order

1. `Basquio/docs/vision.md`
2. `Basquio/docs/architecture.md`
3. `Basquio/memory/canonical-memory.md`
4. `Basquio/rules/canonical-rules.md`
5. `Basquio/docs/stack-practices.md` before changing workflow, ingest, rendering, or brand-token handling
6. `Basquio/docs/brand-system.md` before changing design-system or styling inputs

## Mandatory Update Set

If a structural decision changes, update all relevant files in the same change:

- `Basquio/docs/architecture.md`
- `Basquio/docs/decision-log.md`
- `Basquio/memory/canonical-memory.md`
- `Basquio/rules/canonical-rules.md`
- `Basquio/code/contracts.ts`

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

Recommended before code merge:

```bash
pnpm typecheck:fast
pnpm lint:fast
```
