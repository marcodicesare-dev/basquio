# AI-Native Report Architecture Research

Date: March 14, 2026

## Scope

This note translates the research brief into a concrete target architecture for Basquio:

- evidence package in
- business brief in
- design target in
- executive-grade PPTX and PDF out

Only primary sources were used. Recommendations that go beyond what a source states directly are labeled as inference.

## Research Summary

The best fit for Basquio is not a single general-purpose agent. It is a typed orchestrator that combines:

- explicit workflow stages with retriable checkpoints
- structured-output model calls at each semantic stage
- deterministic analytics execution between LLM stages
- an evaluator-optimizer loop before rendering
- first-class PPTX template interpretation through PresentationML structure
- full stage tracing for auditability

This matches the direction in Anthropic's agent guidance, which distinguishes workflow patterns from open-ended agents and explicitly calls out orchestrator-worker and evaluator-optimizer patterns as useful when subtasks and quality criteria are known ahead of time. It also matches OpenAI's guidance that GPT-5.4 is aimed at long-running, multi-step, production-grade tasks and performs best when prompts specify output contracts, tool-use expectations, and completion criteria.

## Proposed Target Architecture

Basquio should be organized as a planner-executor-critic system with typed checkpoints:

1. Intake and normalize the evidence package, brief, and design target.
2. Infer package semantics across files.
3. Plan executable metrics.
4. Compute analytics deterministically.
5. Rank insights against the brief.
6. Plan the report narrative.
7. Plan the report outline.
8. Translate the design target into concrete slide/layout constraints.
9. Plan slides against both evidence and template constraints.
10. Run deterministic validation.
11. Run an independent semantic critic.
12. If validation fails, backtrack to the right upstream stage and retry.
13. Render PPTX and PDF only after the plan passes both checks.
14. Persist artifacts, validation reports, and stage traces.

## Why This Architecture Fits The Sources

### Durable multi-step orchestration

Inngest's retry model is stage-friendly: each `step.run()` has its own retry counter, retries default to additional attempts, and `NonRetriableError` can stop retries when a problem is not transient. That is a strong fit for stage-based report generation where parsing, planning, analytics, validation, and rendering have different failure modes.

### Evaluator-optimizer review loop

Anthropic's agent guidance recommends simple composable workflows first, and specifically names evaluator-optimizer loops as a pattern when you can generate a candidate, evaluate it, and revise. Basquio maps cleanly onto that pattern because a draft report plan can be evaluated against evidence coverage, numerical correctness, and recommendation logic before rendering.

### Long-running planning models with explicit contracts

OpenAI's GPT-5.4 prompt guidance states that the model is designed for long-running tasks, reliable execution, and strong performance on multi-step workflows, and that it works best when prompts define the output contract, tool-use expectations, and completion criteria. That supports stage-specific JSON-schema contracts rather than one giant freeform prompt.

### First-class PPTX interpretation

Microsoft's Open XML documentation shows that slide layouts and slide masters are explicit PresentationML structures, with placeholders, style inheritance, and layout identifiers. That means PPTX templates can be parsed into real layout constraints instead of being treated as shallow theme hints.

## Stage-By-Stage Orchestration Plan

### Stage 1: Intake

Input:

- uploaded files
- brief
- style input

Output:

- normalized upload manifest
- file fingerprints
- source metadata

Purpose:

- preserve package identity and prepare durable run state

### Stage 2: Package semantics inference

Input:

- `DatasetProfile`
- brief
- file manifest

Output:

- `PackageSemantics`

Responsibilities:

- infer entities
- infer relationships and join hypotheses
- infer time grains
- infer metric candidates
- infer answerable business questions
- infer methodology and support-file roles

### Stage 3: Metric planning

Input:

- `PackageSemantics`
- `DatasetProfile`
- brief

Output:

- `ExecutableMetricSpec[]`

Responsibilities:

- choose what to compute
- choose grouping dimensions
- request derived tables
- define filters, joins, and time windows

Rule:

- the model decides the computation plan
- code executes it deterministically

### Stage 4: Deterministic analytics execution

Input:

- `ExecutableMetricSpec[]`
- normalized rows

Output:

- `AnalyticsResult`

Responsibilities:

- execute metrics
- materialize derived tables
- preserve evidence refs and provenance

### Stage 5: Insight ranking

Input:

- `AnalyticsResult`
- brief
- reviewer feedback when present

Output:

- `InsightSpec[]`

Responsibilities:

- identify what matters
- prioritize by strategic relevance
- attach evidence and confidence

### Stage 6: Narrative planning

Input:

- `InsightSpec[]`
- brief

Output:

- `StorySpec`

Responsibilities:

- define thesis
- decide argumentative arc
- frame implications and recommendations

### Stage 7: Outline planning

Input:

- `StorySpec`
- `InsightSpec[]`

Output:

- `ReportOutline`

Responsibilities:

- define sections
- allocate emphasis
- decide total slide budget range

### Stage 8: Design translation

Input:

- template file or brand-token file

Output:

- `TemplateProfile`

Responsibilities:

- extract fonts, colors, masters, layouts, placeholders, slide size, and source fingerprint
- expose design constraints in a machine-usable contract

### Stage 9: Slide architecture

Input:

- `ReportOutline`
- `StorySpec`
- `InsightSpec[]`
- `AnalyticsResult`
- `TemplateProfile`

Output:

- `SlideSpec[]`

Responsibilities:

- decide slide count
- choose layout by slide purpose
- bind each slide to claims, evidence, charts, notes, and transitions

### Stage 10: Deterministic validation

Input:

- `SlideSpec[]`
- `AnalyticsResult`
- claims and refs

Output:

- deterministic issues

Responsibilities:

- verify evidence ids
- verify chart bindings
- verify numeric assertions
- verify structural consistency

### Stage 11: Semantic critic

Input:

- plan artifacts from prior stages
- deterministic validation result

Output:

- semantic issues with suggested backtrack stage

Responsibilities:

- challenge unsupported claims
- challenge weak recommendation logic
- challenge story coherence
- challenge misuse of evidence

### Stage 12: Revision loop

Input:

- merged validation issues

Output:

- revised metrics, insights, story, outline, or slides

Responsibilities:

- rerun only the stage family implicated by the critic when possible
- preserve trace history across attempts
- stop when the plan passes or attempt budget is exhausted

### Stage 13: Rendering and artifact QA

Input:

- validated `SlideSpec[]`
- `TemplateProfile`

Output:

- PPTX
- PDF
- artifact metadata
- quality report

## Agent Roles Map

The roles should be distinct and non-overlapping:

| Role | Owns | Must Not Do |
| --- | --- | --- |
| Package interpreter | `PackageSemantics` | invent numbers or final story |
| Metric planner | `ExecutableMetricSpec[]` | compute analytics in prose |
| Analytics executor | `AnalyticsResult` | improvise unsupported metrics |
| Insight ranker | `InsightSpec[]` | choose layouts or template details |
| Story architect | `StorySpec` | bind chart fields directly |
| Outline planner | `ReportOutline` | skip explicit section logic |
| Design translator | `TemplateProfile` | render final slides |
| Slide architect | `SlideSpec[]` | ignore template constraints |
| Deterministic validator | `ValidationIssue[]` | judge executive quality alone |
| Semantic critic | semantic issues and backtrack hints | recompute analytics directly |

## Contract And Schema Map

| Stage | Contract |
| --- | --- |
| Intake | upload manifest, file fingerprints, source metadata |
| Package semantics | `PackageSemantics` |
| Metric planning | `ExecutableMetricSpec[]` |
| Analytics execution | `AnalyticsResult` |
| Insight ranking | `InsightSpec[]` |
| Narrative planning | `StorySpec` |
| Outline planning | `ReportOutline` |
| Design translation | `TemplateProfile` |
| Slide architecture | `SlideSpec[]` |
| Validation | `ValidationReport` |
| Auditability | `StageTrace[]` |
| Delivery | `ArtifactManifest`, `QualityReport` |

## Template And Design Recommendations

The design target should become first-class by converting it into explicit constraints before slide planning.

For PPTX inputs:

- parse slide size from the presentation part
- parse theme colors and fonts from the theme part
- parse layout metadata and placeholders from slide layouts and slide masters
- preserve layout names, master names, and placeholder catalogs
- fingerprint the source file so traces and reruns know which template was used

For brand-token inputs:

- map colors, fonts, spacing, logo rules, and typography into the same `TemplateProfile`

Inference from sources:

- Basquio should prefer slide planning against placeholder-bearing layouts instead of free-placement rendering, because PresentationML explicitly encodes layout intent through masters and layouts

## Multi-File Understanding Without Hard-Coded Mapping

The package-understanding stage should reason from file content and structure, not from file names alone.

Recommended approach:

- generate compact file profiles first
- keep row access available for deterministic execution
- infer candidate joins from shared keys, repeated identifiers, time grains, and semantic labels
- infer methodology and support-doc roles separately from fact-table roles
- ask the package-interpreter stage for confidence on joins and unanswered questions

Inference from sources:

- this is better implemented as a planning stage plus deterministic execution stage than as direct tool-calling from one monolithic prompt, because the cited agent guidance favors composable workflows when subproblems and handoff contracts are known

## Model Assignment By Stage

These assignments are recommendations, not direct claims from any one source.

Inference from sources plus current stack:

| Stage family | Recommended model posture |
| --- | --- |
| Package semantics, story, outline, slide planning | strong long-running reasoning model such as GPT-5.4 with medium to high reasoning effort |
| Metric planning | reasoning-capable structured-output model, usually one tier below the heaviest planning model when package complexity is modest |
| Extraction and shallow classification | lighter model settings, including GPT-5.1 with none or low reasoning effort when the task is contract filling rather than long-horizon planning |
| Semantic critic | different provider or at least different model family than the primary planner when available |

Why:

- OpenAI documents GPT-5.4 as a production-grade model for long-running, multi-step workflows and explicit output contracts
- OpenAI documents GPT-5.1 as supporting `none`, `low`, `medium`, and `high` reasoning effort, making it suitable for low-latency structured stages
- Anthropic's evaluator-optimizer guidance supports having a real evaluator stage instead of a disguised repeat of the generator

Operational recommendation:

- persist requested model, resolved model, provider, reasoning effort, prompt version, and fallback reason in `StageTrace`

## Prompt Contract Guidance

Every stage prompt should define:

- the role
- allowed inputs
- the exact output schema
- what uncertainty must be surfaced
- what the model must not do
- completion criteria

Best practice supported by OpenAI's GPT-5.4 guidance:

- define the output contract explicitly
- define tool-use expectations explicitly
- define what "done" means explicitly

## Orchestration Loop Design

Recommended loop:

1. Run semantics.
2. Run metric planning.
3. Execute analytics.
4. Run insight ranking.
5. Run story and outline planning.
6. Run design translation.
7. Run slide planning.
8. Run deterministic validation.
9. Run semantic critique.
10. If issues exist, backtrack to the smallest responsible stage family and retry.
11. If no issues exist, render.

Recommended control rules:

- use attempt budgets that scale with deck size and ambiguity
- treat parse failures, missing files, and invalid joins as non-retriable when they cannot heal automatically
- treat transient provider and network faults as retriable
- persist intermediate artifacts for audit and resume

## Critic And Cross-Model Validation Design

The critic should not just repeat the generator prompt.

Recommended critic checks:

- unsupported or weakly supported claims
- recommendations that do not follow from evidence
- story sections that overstate confidence
- charts whose visual claim does not match the computed metric
- missing counter-evidence or omitted caveats when confidence is low

Inference from sources:

- when both OpenAI and Anthropic are available, use the opposite provider for the semantic critic when practical; this reduces same-model blind spots and better matches the intent of evaluator-optimizer separation

## Observability And Tracing

Basquio should persist:

- run id
- dataset and template fingerprints
- prompt version per stage
- requested model and resolved model
- provider
- reasoning effort when applicable
- fallback reason
- validation issues
- retry count by stage
- final artifact metadata

This is required to make AI-native generation debuggable and trustworthy.

## Failure Handling And Retry Strategy

Use Inngest stage semantics to separate failure classes:

- retriable transient failures: model provider timeouts, temporary network issues, rate limits
- non-retriable contract failures: unparseable input, irreconcilable joins, missing required evidence
- revision-triggering quality failures: critic rejects story, metrics, or slide plan

Recommended behavior:

- transient failure: retry the current step
- contract failure: stop and surface a needs-input state
- quality failure: backtrack to the implicated upstream stage and replan

## Evaluation Framework

Canonical eval case:

- input: 10 SGS sustainability AI visibility source files
- brief: explicit audience, objective, stakes, thesis, and context
- design target: branded SGS PPTX template
- expected output: branded SGS AI visibility deck in PPTX and PDF

Required eval dimensions:

- semantic correctness of joins and entities
- numeric correctness of computed metrics
- evidence coverage per substantive claim
- template fidelity
- section logic and narrative coherence
- recommendation validity
- artifact integrity

Suggested acceptance checks:

- zero broken evidence ids
- zero broken chart bindings
- zero deterministic numeric mismatches
- semantic critic passes without high-severity unsupported-claim issues
- template-derived fonts, colors, and layout families appear in output plan
- reviewer can trace each slide claim back to deterministic evidence

## Phased Implementation Roadmap

### Phase 1: Must fix before canonical SGS success

- make `ExecutableMetricSpec[]` a required contract before analytics
- make PPTX parsing first-class in `TemplateProfile`
- replace fixed-spine slide planning with outline-driven dynamic slide architecture
- add semantic critic and backtrack loop before rendering
- persist `StageTrace` for every LLM-assisted stage

### Phase 2: Make the system auditable and scalable

- add richer join-confidence and unanswered-question reporting in `PackageSemantics`
- improve attempt budgeting by deck size and ambiguity
- persist intermediate stage artifacts for deeper replay and inspection
- add richer semantic eval sets around recommendation quality

### Phase 3: Raise report quality ceiling

- stronger package-understanding prompts and benchmarks
- richer template-matching logic for placeholder families and master inheritance
- better design translation from token files
- canonical eval suites beyond SGS

## Anti-Patterns To Avoid

- one giant prompt that both interprets the package and invents the output
- hard-coded filename mapping for report logic
- hard-coded slide spines
- treating template input as a shallow theme fallback
- letting the model compute numbers in prose instead of code
- deterministic validation without semantic critique
- semantic critique without backtracking
- silent fallbacks with no trace
- using preview-component props as the export contract

## Blunt Gap Analysis Of Current Systems

What usually makes current systems fail at this problem:

- they confuse "LLM can summarize data" with "system understands an evidence package"
- they never separate planning from execution, so metrics become hand-wavy prose
- they treat templates as color palettes instead of structural constraints
- they hard-code slide count and report sections
- they validate syntax but not reasoning
- they cannot explain which model, prompt, or fallback produced a weak output
- they optimize for fast demos instead of auditable deliverables

## Conceptual Gap In Current Basquio

Before this refactor, the repo shape was moving in the right direction but still missed the core behavior:

- slide planning was too close to a scripted deck composer
- template interpretation did not yet materially drive planning
- metric discovery was too shallow and too heuristic
- validation was deterministic-only
- orchestration behaved like a single forward pass instead of a planner-critic loop
- model fallbacks were not sufficiently auditable

## Sources

- Anthropic, "Building effective agents": https://www.anthropic.com/research/building-effective-agents
- Anthropic, "Effective harnesses for long-running agents": https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Microsoft Learn, "Working with slide layouts": https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-slide-layouts
- Microsoft Learn, "Working with slide masters": https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-slide-masters
- Inngest docs, "Retries": https://www.inngest.com/docs/features/inngest-functions/error-retries/retries
- Inngest docs, "Errors": https://www.inngest.com/docs/features/inngest-functions/error-retries/inngest-errors
- OpenAI docs, "Prompt guidance for GPT-5.4": https://developers.openai.com/api/docs/guides/prompt-guidance/
- OpenAI docs, "Using GPT-5.4": https://developers.openai.com/api/docs/guides/latest-model/
- OpenAI API reference search results for reasoning effort and structured outputs in GPT-5.1: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/
- OpenAI cookbook, "GPT-5 New Params and Tools": https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_new_params_and_tools/
- Self-Refine: Iterative Refinement with Self-Feedback: https://arxiv.org/abs/2303.17651
- Reflexion: Language Agents with Verbal Reinforcement Learning: https://arxiv.org/abs/2303.11366
- LLMCompiler: https://arxiv.org/abs/2312.04511
