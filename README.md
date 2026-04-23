# Basquio Context Pack

Basquio is an intelligence-first presentation generator.

The core product is not "AI that makes slides." The core product is a system that:

- understands business datasets
- extracts evidence-backed insights
- plans an executive narrative from general to specific
- renders the result as editable PowerPoint and polished PDF

This folder is the canonical build context for the product.

## Read Order

1. `docs/vision.md`
2. `docs/architecture.md`
3. `docs/research-synthesis.md`
4. `docs/decision-log.md`
5. `memory/canonical-memory.md`
6. `rules/canonical-rules.md`
7. `agents/agents.yaml`
8. `docs/stack-practices.md`
9. `docs/brand-system.md`
10. `docs/design-synthesis.md`
11. `skills/graph.md`

## Required QA

Run this before implementation work and before merging architecture changes:

```bash
pnpm qa:basquio
```

`qa:basquio` runs the context-QA context check plus the full Vitest suite (50+ unit tests across research, intelligence, workflows).

Recommended companion checks before shipping code:

```bash
pnpm typecheck         # tsc --noEmit across the monorepo
pnpm lint              # next lint on apps/web
pnpm test              # vitest in watch mode
pnpm test:run          # vitest single run
pnpm test:coverage     # vitest with v8 coverage (thresholds enforced)
pnpm qa:catalog        # linked-remote catalog sanity check
```

## Git hooks (Lefthook)

Pre-commit and pre-push hooks run automatically via [Lefthook](https://github.com/evilmartians/lefthook). `pnpm install` wires them through the `postinstall` script. If the automatic install fails (older lefthook versions, monorepo quirks), run the manual fallback:

```bash
pnpm lefthook install
```

What the hooks enforce:

- **pre-commit**: em-dash audit (no U+2014 in staged diff), secret scan (no `sk-ant-api03-`, `sk_live_`, `fc-`, or JWT-like tokens), NIQ hardening guard (22406d5 files are hands-off), type-check, Vitest run.
- **pre-push**: if any `supabase/migrations/**` staged, run `pnpm qa:catalog`; outgoing-commit secret scan as a second line of defense.

Emergency bypass (**use sparingly**): `LEFTHOOK=0 git commit ...`. If you need to touch the NIQ hardening surface with Marco's green light, prefer `BASQUIO_NIQ_GUARD_OVERRIDE=1 git commit ...`.

## Pack Structure

- `docs/`: vision, architecture, roadmap, and merged decision record
- `docs/stack-practices.md`: official-source stack guidance for Supabase, Inngest, Browserless, charts, PPTX, and ingest
- `docs/brand-system.md`: imported Basquio logo and palette rules
- `docs/design-synthesis.md`: useful design patterns extracted from CostFigure and Inngest
- `docs/first-generation-test.md`: first local path to generate PPTX and PDF outputs
- `memory/`: canonical memory that must stay in sync with reality
- `rules/`: build rules, QA rules, and prompt contracts
- `agents/`: orchestration graph and specialized agents
- `skills/`: reusable execution playbooks
- `code/`: canonical TypeScript contracts for structured planning
- `scripts/`: QA for the context pack itself
