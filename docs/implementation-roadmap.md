# Implementation Roadmap

## Phase 0: Context And Contracts

Deliver:

- canonical docs
- memory
- rules
- agent graph
- structured contracts
- QA script

Exit criteria:

- `pnpm qa:basquio` passes
- core schemas compile

## Phase 1: Greenfield MVP

Deliver:

- Next.js app scaffold
- Supabase project wiring
- Inngest job scaffold
- file upload flow
- system templates only
- `.xlsx` plus free-text context input
- `DatasetProfile -> StorySpec -> SlideSpec[]` pipeline
- PPTX plus PDF output

Exit criteria:

- produce a 6 to 12 slide deck from a realistic FMCG workbook
- store artifacts and return signed URLs

## Phase 2: Intelligence Hardening

Deliver:

- deterministic metrics library
- insight ranking
- evidence attachments
- confidence scoring
- chart recommendation engine
- QA heuristics for output quality

Exit criteria:

- repeated runs stay within acceptable narrative variance
- each generated slide can be traced to evidence

## Phase 3: Template Intelligence

Deliver:

- customer `.pptx` template ingestion
- `TemplateProfile`
- placeholder and layout mapping
- stricter template validation

Exit criteria:

- customer template can be ingested and reused without manual slide rebuilding

## Phase 4: Advanced Productization

Deliver:

- PDF style extraction assist
- per-slide editing
- regeneration by section
- retrieval over prior decks and patterns
- approval checkpoints

Exit criteria:

- human-in-the-loop workflow is stable
- generated outputs can be revised without full rerun
