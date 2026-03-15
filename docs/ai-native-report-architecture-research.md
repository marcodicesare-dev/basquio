# AI-Native Report Architecture Research

Date: March 15, 2026

## Scope

This memo answers one question:

What is the best end-to-end architecture for Basquio if the product goal is:

- multiple evidence files in
- business brief in
- design target in
- executive-grade PPTX and PDF out

This is not research for a generic slide generator.
It is research for an evidence-to-report system that should behave like a small team of analysts, strategists, reviewers, and presentation designers.

Only primary sources were used.
Recommendations that go beyond the sources directly are labeled as inference.

## Executive Take

The state-of-the-art answer is not "one strong model plus a few helpers."

The best fit for Basquio is:

- a typed multi-stage orchestrator
- durable checkpoints per stage
- LLM stages that emit structured contracts
- deterministic analytics execution between LLM stages
- an evaluator-optimizer loop before rendering
- first-class template translation from real PPTX structure
- export-aware chart rendering, not preview-first charting
- full run tracing, prompt versioning, and eval-driven iteration

In other words:

- AI should decide what the package means
- AI should decide what to compute
- code should compute the numbers
- AI should decide what matters
- AI should decide how to tell the story
- AI should decide how the deck should be structured
- a separate critic should decide whether the deck is actually defensible
- rendering should happen only after the plan survives both deterministic and semantic QA

## What The Sources Actually Support

### 1. Use workflows before autonomous free-form agents

Anthropic's guidance explicitly recommends starting with the simplest composable agentic pattern that fits the problem, and names prompt chaining, routing, orchestrator-workers, and evaluator-optimizer as useful patterns when subtasks are known ahead of time.

Why that matters for Basquio:

- the subtasks are known
- the handoffs can be typed
- the failure modes are different by stage
- the quality bar is too high for a monolithic prompt

Inference:

Basquio should not be built as a single "research everything and make a deck" agent.
It should be built as a workflow of specialist stages with typed outputs.

### 2. Long-running work should be asynchronous and durable

OpenAI's Background mode guide says long-running tasks should run asynchronously and be polled over time.
OpenAI's Deep Research guide says agentic multi-step research can take tens of minutes, recommends Background mode, and recommends webhooks for completion notification.
Inngest documents durable step boundaries, independent retries for steps, idempotency controls, and explicit non-retriable error handling.

Why that matters for Basquio:

- large decks should be allowed to think longer than small decks
- parsing, planning, critique, and render should not share one fragile request lifecycle
- revision loops need durable checkpoints

Inference:

Basquio should use Inngest as the outer durable workflow runtime, and long model calls that may exceed ordinary HTTP expectations should use async/background execution patterns inside those stages where practical.

### 3. Strong prompts are not enough; contracts and verification loops matter

OpenAI's GPT-5.4 prompt guidance says the model performs best when prompts specify the output contract, tool-use expectations, and completion criteria.
The same guide says reasoning effort is a last-mile knob, and many quality gains come first from stronger prompts, clear contracts, and lightweight verification loops.

Why that matters for Basquio:

- the answer is not "turn reasoning up"
- the answer is "give each stage a narrow job, strict schema, and explicit definition of done"

Inference:

Basquio should prefer stage-specific JSON-schema contracts over giant prose prompts.

### 4. Evaluation must be built in, not bolted on

OpenAI's evaluation best-practices doc recommends eval-driven development, stage-specific evals, logging everything, and calibrating automated graders against human judgment.
OpenAI's trace-grading guidance recommends grading traces, not just black-box outputs.

Why that matters for Basquio:

- a deck can look plausible while being analytically wrong
- the real unit of quality is the full run: package understanding, metrics, story, slide plan, and validation history

Inference:

Basquio should store stage traces and grade them, not just score final decks.

### 5. Template input must come from real PresentationML structure

Microsoft's Open XML docs show that PowerPoint masters and layouts are explicit structures with layout identity, inheritance, and placeholders.
PptxGenJS supports masters and placeholders for generated content, but it is fundamentally a generation library.
pptx-automizer exists specifically to modify existing PPTX templates and import/customize existing slides, while also documenting the limits of layout-level manipulation.

Why that matters for Basquio:

- a customer PPTX template is not just a color palette
- layout identity, placeholder catalog, slide size, text styles, and master inheritance all matter
- if Basquio wants true enterprise template fidelity, it cannot stop at theme extraction

Inference:

Basquio should treat PPTX parsing as a first-class translation stage and should be willing to use a hybrid rendering strategy:

- canonical planning contracts stay renderer-agnostic
- standard slides can still be generated from `SlideSpec[]`
- template-critical outputs should use OOXML-aware template instantiation, not only free-placement drawing

### 6. Export-grade visuals require export-grade rendering choices

Apache ECharts documents SVG SSR for export use cases.
Browserless documents a robust HTML-to-PDF path with explicit wait controls.

Why that matters for Basquio:

- preview charts and export charts are not the same problem
- PDF generation should be deterministic and server-side
- advanced charts should render as export assets, not UI leftovers

Inference:

The best rendering split remains:

- native editable PPT charts for standard bar/line/pie/scatter families when editability matters
- ECharts SVG SSR for advanced or design-critical visuals
- Browserless for PDF generation from a controlled export HTML layer

### 7. Workbook parsing should stay honest about boundaries

SheetJS documents full-workbook parsing, selective sheet parsing, and encryption limits.

Why that matters for Basquio:

- file parsing is not business understanding
- the pipeline needs a clean boundary between raw workbook extraction and semantic interpretation

Inference:

Basquio should:

- parse files into normalized data structures first
- profile them second
- infer package semantics third
- never fuse parsing logic with story logic

## The Right End-To-End Architecture

### Inputs

Basquio should treat these as mandatory first-class inputs:

1. Evidence package
   - multiple CSV, XLS, XLSX, and support files
2. Knowledge brief
   - audience
   - objective
   - thesis
   - stakes
   - business context
3. Design target
   - PPTX template, design token file, or style reference

### Core principle

Each stage should answer one kind of question:

- what is this package
- what should be computed
- what did the computation show
- what matters most
- what is the argument
- how many slides and sections should exist
- how should each slide work
- does the plan survive critique

### Canonical stage graph

1. Intake and profiling
2. Package semantics inference
3. Metric planning
4. Deterministic analytics execution
5. Insight ranking
6. Story architecture
7. Outline architecture
8. Design translation
9. Slide architecture
10. Deterministic validation
11. Independent semantic critique
12. Targeted revision loop
13. PPTX and PDF rendering
14. Artifact QA and delivery

## Stage-By-Stage Contracts

### Stage 1: Intake and profiling

Input:

- uploaded files
- brief
- design target

Output:

- `UploadManifest`
- `DatasetProfile[]`
- `TemplateInputManifest`
- `RunEnvelope`

Purpose:

- durable identity
- fingerprints
- sheet and column previews
- file role hints
- initial size and complexity estimate

Design note:

This stage should not attempt business reasoning.

### Stage 2: Package semantics inference

Input:

- `DatasetProfile[]`
- brief
- support-doc snippets when present

Output:

- `PackageSemantics`

This contract should include:

- entities
- candidate relationships with explicit `leftFile`, `leftKey`, `rightFile`, `rightKey`
- join confidence and rationale
- time grains
- definitions and methodology hints
- likely fact tables vs support tables
- unanswered questions
- answerable business questions

Why:

This is the "understand the package" stage.
It is where AI proves it can read the evidence package instead of following filename heuristics.

### Stage 3: Metric planning

Input:

- `PackageSemantics`
- `DatasetProfile[]`
- brief

Output:

- `ExecutableMetricSpec[]`

This contract should include:

- metric id
- business question served
- source files used
- join path
- filters
- grouping dimensions
- aggregation method
- time windows
- derived-table requirements
- expected output shape
- evidence lineage expectations

Rule:

The model proposes the computation plan.
Code executes it.

### Stage 4: Deterministic analytics execution

Input:

- `ExecutableMetricSpec[]`
- normalized rows

Output:

- `AnalyticsResult`

This contract should include:

- materialized metric outputs
- derived tables
- evidence refs
- provenance
- warnings

Rule:

No model improvisation here.

### Stage 5: Insight ranking

Input:

- `AnalyticsResult`
- brief

Output:

- `InsightSpec[]`

This contract should include:

- claim
- why it matters to the brief
- evidence refs
- confidence
- severity or opportunity score
- caveats

Purpose:

- separate "interesting statistic" from "important executive insight"

### Stage 6: Story architecture

Input:

- `InsightSpec[]`
- brief

Output:

- `StorySpec`

This contract should include:

- working thesis
- counterpoints
- section goals
- implication ladder
- recommendation themes

Purpose:

- decide the argument, not the slides

### Stage 7: Outline architecture

Input:

- `StorySpec`
- `InsightSpec[]`
- complexity estimate

Output:

- `ReportOutline`

This contract should include:

- section order
- slide budget range
- emphasis allocation
- transition intent between sections

Purpose:

- decide whether this deck is 7 slides or 27 slides
- this is where larger decks earn more time and more revision budget

### Stage 8: Design translation

Input:

- PPTX template or token file

Output:

- `TemplateProfile`

This contract should include:

- slide size
- theme fonts
- theme colors
- master identities
- layout identities
- placeholder types
- placeholder geometry
- text-style inheritance hints
- safe layout families by slide purpose
- source fingerprint

Purpose:

- convert design input into machine-usable constraints before slide planning

### Stage 9: Slide architecture

Input:

- `ReportOutline`
- `StorySpec`
- `InsightSpec[]`
- `AnalyticsResult`
- `TemplateProfile`

Output:

- `SlideSpec[]`

This contract should include, for each slide:

- slide objective
- section id
- slide claim
- evidence refs
- layout family
- placeholder mapping
- chart binding
- transition intent
- notes and caveats

Purpose:

- decide the actual deck
- not just "put insight 1 on slide 1"

### Stage 10: Deterministic validation

Input:

- `SlideSpec[]`
- `AnalyticsResult`

Output:

- deterministic validation issues

Checks:

- evidence ids resolve
- chart bindings resolve
- numbers on slides match computed outputs
- slide structure is internally consistent

### Stage 11: Independent semantic critique

Input:

- plan artifacts from prior stages
- deterministic validation result

Output:

- `SemanticReview`

Checks:

- unsupported claims
- recommendations not justified by evidence
- narrative incoherence
- overstated certainty
- misleading chart rhetoric
- missing caveats or counter-evidence
- likely backtrack stage

Purpose:

- one AI should not grade itself in disguise

### Stage 12: Targeted revision loop

Input:

- deterministic issues
- semantic issues

Output:

- revised stage artifacts

Control rule:

Backtrack to the smallest responsible stage family:

- semantics
- metrics
- insights
- story
- outline
- slides

Do not restart the whole run unless the package understanding itself is broken.

### Stage 13: Rendering

Input:

- validated `SlideSpec[]`
- `TemplateProfile`

Output:

- PPTX
- PDF

Renderer policy:

- PPTX path should prefer native editable charts for standard families
- advanced visuals should use ECharts SVG SSR
- PDF path should render from an export-controlled HTML layer via Browserless

### Stage 14: Artifact QA and delivery

Input:

- artifacts
- validation outputs
- run trace

Output:

- `ArtifactManifest`
- `QualityReport`
- audit trail

## Agent Roles Map

The roles should be distinct and non-overlapping.

| Role | Owns | Must not do |
| --- | --- | --- |
| Package interpreter | `PackageSemantics` | compute metrics in prose or decide final deck |
| Metric planner | `ExecutableMetricSpec[]` | tell the story |
| Analytics executor | `AnalyticsResult` | invent business meaning |
| Insight ranker | `InsightSpec[]` | choose slide layouts |
| Story architect | `StorySpec` | bind raw fields to charts |
| Outline architect | `ReportOutline` | decide numeric truth |
| Design translator | `TemplateProfile` | decide business claims |
| Slide architect | `SlideSpec[]` | ignore template constraints |
| Deterministic validator | validation issues | judge strategic quality alone |
| Semantic critic | `SemanticReview` | recompute metrics directly |

## Long-Running Orchestration Model

### Durable outer runtime

Inference from sources:

Use Inngest as the outer job runtime because the workload maps well to:

- step-level retries
- durable checkpoints
- idempotent event handling
- resumable multi-stage work

### Async model execution for heavy stages

Inference from sources:

For very long model calls, especially large package interpretation or deep critique on big decks, use asynchronous/background model execution patterns instead of assuming each model call fits comfortably inside normal synchronous request expectations.

### Attempt budgeting

Attempt budgets should scale by complexity:

- small deck, clean package: fewer loops
- large deck, ambiguous package: more loops

Complexity inputs should include:

- number of files
- total rows
- number of inferred relationships
- number of unanswered package questions
- requested slide budget
- critic rejection severity

### Failure classes

1. Transient
   - rate limit
   - timeout
   - temporary storage/network issue
2. Contract failure
   - unreadable input
   - encrypted unsupported workbook
   - irreconcilable join ambiguity
   - invalid template
3. Quality failure
   - critic rejection
   - unsupported claim
   - recommendation logic failure

Behavior:

- transient: retry current step
- contract failure: stop and request input correction
- quality failure: backtrack to implicated stage and revise

## Model Assignment

These assignments are recommendations inferred from the official model guidance, not direct claims from a single source.

### Package semantics

- strongest reasoning model available
- medium or high reasoning effort

Reason:

- long-context interpretation
- ambiguity handling
- multi-file reasoning

### Metric planning

- strong structured-output model
- low to medium reasoning effort unless ambiguity is high

Reason:

- it is planning-heavy but bounded

### Insight ranking, story, outline, slide architecture

- strong reasoning model
- medium reasoning effort by default
- raise to high for large decks or heavy ambiguity

Reason:

- these are multi-step synthesis tasks

### Light normalization and extraction

- fast low-cost model
- minimal or none reasoning

Reason:

- OpenAI explicitly recommends low/no reasoning for lightweight structured transforms and extraction

### Semantic critic

- different provider or at least different model family than the primary planner when practical

Reason:

- reduces same-model blind spots
- better matches evaluator-optimizer intent

## Template System Recommendation

### What Basquio should do

1. Parse the uploaded PPTX as PresentationML, not as a vague visual hint.
2. Build a `TemplateProfile` that includes master/layout identity and placeholder geometry.
3. Let the slide architect plan against those layout families.
4. Render standard generated slides from the canonical `SlideSpec[]`.
5. When enterprise template fidelity is critical, use a template-instantiation path that can modify existing PPTX structures instead of only drawing new objects onto blank slides.

### Why

Inference from sources:

PptxGenJS is strong for generation.
Open XML is the source of truth for template structure.
pptx-automizer shows that real template modification is possible, while also documenting real limitations.

So the state-of-the-art answer is not "replace everything with one library."
It is a hybrid:

- plan in a canonical format
- parse templates structurally
- instantiate with the right renderer for the fidelity target

## Chart And Visual Recommendation

### Standard business charts

Use native editable PPT charts where possible:

- bar
- line
- pie
- scatter

Why:

- editability matters to enterprise buyers

### Advanced or design-critical visuals

Use ECharts SVG SSR.

Why:

- export quality
- deterministic server-side rendering
- stronger visual control

### PDF

Use Browserless from controlled export HTML.

Why:

- deterministic output
- explicit wait controls
- consistent rendering path

## Evaluation Framework

### Canonical case

Use the SGS-style benchmark the product keeps referring to:

- 10 source files in
- business brief in
- branded SGS-like template in
- executive deck out

### What to evaluate

1. Package understanding
   - entity correctness
   - join correctness
   - methodology interpretation
2. Metric planning
   - right computations chosen
   - right grouping choices
3. Analytics execution
   - numeric correctness
   - lineage correctness
4. Insight quality
   - relevance to brief
   - evidence coverage
5. Narrative quality
   - coherence
   - recommendation validity
6. Slide planning
   - layout fit
   - chart fit
   - section logic
7. Template fidelity
   - colors
   - typography
   - layout family use
   - placeholder adherence
8. Output quality
   - PPTX integrity
   - PDF integrity

### How to evaluate

Use three layers:

1. Deterministic checks
2. LLM graders on stage artifacts and traces
3. Human calibration set

Inference from sources:

The best Basquio eval program should grade traces, not only final decks.

### Acceptance rules for the canonical eval

- zero unresolved deterministic numeric mismatches
- zero broken evidence refs
- zero broken chart bindings
- no high-severity semantic critic failures
- every substantive slide claim maps to deterministic evidence
- template-derived layout families appear in the plan
- human reviewers agree the deck could credibly be sent to an executive audience

## What Basquio Should Stop Doing

These are the anti-patterns to kill completely.

- one giant prompt that both understands the package and invents the deck
- hard-coded slide spines
- filename-based mapping pretending to be intelligence
- model-written numbers that are not executed by code
- using the same model twice and calling the second pass a critic
- treating template input as a color palette only
- treating preview chart code as export architecture
- swallowing model failures or fallback reasons
- running long jobs inside fragile synchronous request lifecycles
- shipping before trace-based evals exist

## Blunt Gap Analysis

What makes systems like this fail in practice:

- they optimize for demo speed, not evidence integrity
- they confuse "can summarize files" with "understands the package"
- they never separate computation planning from computation execution
- they generate recommendations before proving the evidence path
- they do not let design constraints shape slide planning early enough
- they validate syntax and formatting, not business defensibility
- they do not preserve enough trace data to debug failures

## Recommended Basquio Roadmap

### Phase 1: Make the intelligence loop real

- harden `PackageSemantics`
- require explicit `ExecutableMetricSpec[]`
- route every claim through deterministic analytics lineage
- make semantic critique mandatory before render

### Phase 2: Make template input truly enterprise-grade

- complete placeholder-geometry parsing
- add template-instantiation path for high-fidelity PPTX outputs
- benchmark layout adherence on a canonical branded template set

### Phase 3: Make long runs robust

- keep all stages durable in Inngest
- add async/background model execution where stage duration warrants it
- scale revision budgets by package complexity
- improve queue, progress, and recovery observability

### Phase 4: Make quality measurable

- build canonical SGS-style eval set
- add stage-level and trace-level graders
- calibrate automated graders with human review
- track prompt/model/version regressions over time

## Updated Research Prompt

Use the canonical prompt in [architecture-research-prompt.md](/Users/marcodicesare/Documents/Projects/basquio/docs/architecture-research-prompt.md).

## Sources

- Anthropic, "Building effective agents": https://www.anthropic.com/research/building-effective-agents
- Anthropic, "Effective harnesses for long-running agents": https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic, "Context engineering for agents": https://www.anthropic.com/engineering/context-engineering-for-agents
- OpenAI docs, "Background mode": https://developers.openai.com/api/docs/guides/background/
- OpenAI docs, "Deep research": https://developers.openai.com/api/docs/guides/deep-research/
- OpenAI docs, "Prompt guidance for GPT-5.4": https://developers.openai.com/api/docs/guides/prompt-guidance/
- OpenAI docs, "Evaluation best practices": https://developers.openai.com/api/docs/guides/evaluation-best-practices/
- OpenAI docs, "Trace grading": https://developers.openai.com/api/docs/guides/trace-grading/
- OpenAI cookbook, "Temporal Agents with Knowledge Graphs": https://developers.openai.com/cookbook/examples/partners/temporal_agents_with_knowledge_graphs/temporal_agents/
- Microsoft Learn, "Working with slide layouts": https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-slide-layouts
- Microsoft Learn, "Working with slide masters": https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-slide-masters
- Inngest docs, "Handling idempotency": https://www.inngest.com/docs/guides/handling-idempotency
- Inngest docs, "Retries": https://www.inngest.com/docs/features/inngest-functions/error-retries/retries
- Inngest docs, "Errors": https://www.inngest.com/docs/features/inngest-functions/error-retries/inngest-errors
- PptxGenJS docs, "Slide Masters and Placeholders": https://gitbrent.github.io/PptxGenJS/docs/masters/
- pptx-automizer README: https://github.com/singerla/pptx-automizer
- Apache ECharts, "Server-side Rendering": https://echarts.apache.org/en/tutorial.html#Server-side%20Rendering
- Browserless docs, "PDF API": https://docs.browserless.io/rest-apis/pdf-api
- SheetJS docs, "Parse Options": https://docs.sheetjs.com/docs/api/parse-options
