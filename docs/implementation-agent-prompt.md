# Canonical Implementation Prompt

Use this prompt when asking the next agent to stop patching Basquio and make the system actually work end to end.

## Prompt

You are the implementation agent for Basquio.

Your job is not to add another patch.
Your job is to make Basquio work as a truly AI-native evidence-to-report system, end to end.

You are working in:

- `/Users/marcodicesare/Documents/Projects/basquio`

Before changing code, read:

- `/Users/marcodicesare/Documents/Projects/basquio/docs/vision.md`
- `/Users/marcodicesare/Documents/Projects/basquio/docs/architecture.md`
- `/Users/marcodicesare/Documents/Projects/basquio/memory/canonical-memory.md`
- `/Users/marcodicesare/Documents/Projects/basquio/rules/canonical-rules.md`
- `/Users/marcodicesare/Documents/Projects/basquio/docs/stack-practices.md`
- `/Users/marcodicesare/Documents/Projects/basquio/docs/ai-native-report-architecture-research.md`

Also read the canonical research prompt:

- `/Users/marcodicesare/Documents/Projects/basquio/docs/architecture-research-prompt.md`

## Product requirement

Basquio must take:

1. a multi-file evidence package, ideally CSV/XLS/XLSX plus support docs
2. a design target, ideally a PPTX template or file-backed token system
3. a knowledge brief with audience, objective, thesis, stakes, and business context

And produce:

- an executive-grade PPTX
- an executive-grade PDF

This is not a generic slide generator.
This is not "upload CSV, get random deck."
This is not allowed to depend on hard-coded case-by-case mapping.

The AI must understand the package.
The AI must decide what to compute.
Code must compute the numbers deterministically.
Different AIs must own different jobs.
The design input must materially shape the output.
A separate critic must be able to reject the deck before render.
Large decks must be allowed to think longer and revise more than small decks.

## What success looks like

Basquio should behave like this:

1. Parse every uploaded file into normalized data plus compact profiles.
2. Infer package semantics across files without filename hacks.
3. Produce explicit executable metric specs.
4. Run deterministic analytics from those specs.
5. Rank what matters relative to the brief.
6. Build a narrative arc.
7. Decide the outline and slide budget.
8. Translate the uploaded template or brand file into real layout constraints.
9. Plan each slide with claim, evidence, chart binding, layout, and transition.
10. Run deterministic validation.
11. Run an independent semantic critic.
12. Backtrack only to the stage that is actually wrong.
13. Render PPTX and PDF only after the plan survives QA.

## Core architecture you should implement

The target stage graph is:

1. intake and profiling
2. package semantics inference
3. metric planning
4. deterministic analytics execution
5. insight ranking
6. story architecture
7. outline architecture
8. design translation
9. slide architecture
10. deterministic validation
11. independent semantic critique
12. targeted revision loop
13. PPTX and PDF rendering
14. artifact QA and delivery

The contracts that must exist and actually drive behavior are:

- `DatasetProfile[]`
- `TemplateProfile`
- `PackageSemantics`
- `ExecutableMetricSpec[]`
- `AnalyticsResult`
- `InsightSpec[]`
- `StorySpec`
- `ReportOutline`
- `SlideSpec[]`
- `ValidationReport`
- `StageTrace[]`

## Hard requirements

- No hard-coded filename mapping.
- No fixed slide spine.
- No story generation before deterministic analytics.
- No template handling that only extracts colors and fonts.
- No semantic critic that is just the generator run twice.
- No long-running execution that depends on one fragile synchronous request.
- No silent model fallback or swallowed errors.
- No chart architecture that is just preview code reused for export.

## Implementation priorities

### Priority 1: Intelligence correctness

Make sure:

- package semantics can represent explicit left-key/right-key joins
- metric planning is mandatory before analytics
- analytics execution is deterministic and auditable
- insight ranking is tied to the brief and evidence
- story and outline are separate stages
- slide planning is dynamic and layout-aware

### Priority 2: Critic loop

Make sure:

- deterministic validation can fail the run
- semantic critique can fail the run
- the semantic critic identifies the likely backtrack stage
- the workflow loops back to the smallest responsible stage

### Priority 3: Template truth

Make sure:

- PPTX parsing preserves layout identity, placeholder identity, placeholder geometry, slide size, theme, and master inheritance
- the slide planner plans against template constraints
- the render path can honor those constraints
- if existing libraries are insufficient, introduce a hybrid OOXML-aware template-instantiation path instead of pretending free-placement rendering is enough

### Priority 4: Long-running orchestration

Make sure:

- Inngest owns the durable outer workflow
- all major stages are durable checkpoints
- heavy model stages can run asynchronously where needed
- progress reporting reflects real stage state
- queued or stalled jobs are recoverable from persisted request state

### Priority 5: Rendering quality

Make sure:

- standard charts use native editable PPT charts where possible
- advanced or design-critical visuals use ECharts SVG SSR
- PDF generation uses Browserless from controlled export HTML
- PPTX and PDF both come from the same canonical `SlideSpec[]`

## Concrete deliverables

You must produce:

1. Code changes that move Basquio materially toward the target architecture.
2. Any required contract changes in:
   - `/Users/marcodicesare/Documents/Projects/basquio/code/contracts.ts`
3. Matching architecture updates in:
   - `/Users/marcodicesare/Documents/Projects/basquio/docs/decision-log.md`
   - `/Users/marcodicesare/Documents/Projects/basquio/memory/canonical-memory.md`
4. If needed, updates to:
   - `/Users/marcodicesare/Documents/Projects/basquio/docs/architecture.md`
   - `/Users/marcodicesare/Documents/Projects/basquio/docs/stack-practices.md`
5. A clear explanation of what changed and what still remains.

## Evaluation and verification

You are not done until you verify as much of this as possible.

Required checks:

- `pnpm typecheck`
- `pnpm build`
- `pnpm qa:basquio`

Also do end-to-end checks where relevant:

- browser automation for real run creation and progress UX
- API verification for job state and recovery
- artifact verification for PPTX and PDF generation

If you need sample inputs, use the existing Basquio generation flow and any available local or stored job artifacts.

## Working style

- Do not stop at analysis.
- Do not propose a plan without implementing.
- Do not paper over broken architecture with UX-only changes.
- If a library boundary is the real blocker, say so and replace or extend the architecture honestly.
- Prefer a few real end-to-end fixes over many superficial tweaks.
- Persist until the stage you are touching is genuinely better and verified.

## Final output format

When you are done, report:

1. what was actually implemented
2. what was verified
3. what remains not yet 10/10
4. the exact files changed
5. the exact commands run

Be blunt.
Do not call the system "done" or "AI native" unless the code really supports that claim.
