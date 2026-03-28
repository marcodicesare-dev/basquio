# AGENTS.md

## Basquio Local Rules

When working inside this repo:

1. Read `docs/vision.md`, `docs/architecture.md`, and `memory/canonical-memory.md` first.
2. Treat `rules/canonical-rules.md` as the execution contract.
3. Read `docs/stack-practices.md` before changing Supabase, Inngest, Browserless, charting, PPTX, or workbook parsing behavior.
4. Read `docs/brand-system.md` and `docs/design-synthesis.md` before changing Basquio branding or overall shell design.
5. Do not change architecture without updating:
   - `docs/decision-log.md`
   - `memory/canonical-memory.md`
   - `code/contracts.ts`
6. Run `pnpm qa:basquio` after context changes.
7. Prefer changes that strengthen the intelligence layer over UI polish.
8. When changing Supabase-backed runtime code, verify REST-selected columns against the migration-defined schema before shipping.
9. When production behavior and local behavior diverge, trust exported logs and runtime evidence over code assumptions.

## Product Reminder

Basquio is a report-generation system for structured evidence packages.

The expected input is:

- one or more structured data files
- a report brief with context, audience, objective, and thesis
- a brand input such as a PPTX template or brand-token file

The expected output is:

- an executive-grade PPTX
- an executive-grade PDF

Do not reduce the product goal to "upload CSV, get random deck."

## Basquio Skills

- `skills/basquio-foundation/SKILL.md`
- `skills/basquio-intelligence/SKILL.md`
- `skills/basquio-rendering/SKILL.md`
- `skills/basquio-stack-context/SKILL.md`
- `skills/basquio-runtime-forensics/SKILL.md`
