# Skill Graph

## Skill Routing

- `basquio-foundation`: use for repo setup, architecture changes, contracts, dataset-package boundaries, brand-input contracts, database/workflow decisions, and baseline scaffolding
- `basquio-stack-context`: use for official stack behavior, Supabase/Inngest/Browserless/charting/PPTX/ingest/design-token best practices, and library-specific execution constraints
- `basquio-intelligence`: use for evidence-package understanding, insight generation, evidence policies, evaluation, and report-story planning
- `basquio-rendering`: use for PPTX/PDF/template/chart/brand-system implementation decisions and for canonical product-surface design work on the landing page, shell, templates, artifacts, and report-generation UI

## Required Order For New Workstreams

1. foundation
2. stack-context
3. intelligence
4. rendering
5. QA

## Design Canon Routing

- when changing Basquio visual direction, shell structure, landing page framing, or report-generation product surfaces, route through `basquio-rendering`
- for those tasks, future agents should read `Basquio/docs/brand-system.md` and `Basquio/docs/design-synthesis.md` in addition to the normal canonical product context
