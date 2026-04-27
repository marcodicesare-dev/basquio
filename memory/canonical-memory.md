# Canonical Memory

## Always True Until Explicitly Changed

- Basquio is intelligence-first, renderer-second.
- The moat is package understanding, metric planning, deterministic analytics, insight ranking, narrative planning, slide architecture, and critique.
- Basquio should understand multi-file evidence packages, not only single spreadsheets.
- dataset manifests are the canonical file-role layer for evidence-package understanding.
- `PackageSemantics` is required before trustworthy analytics planning.
- The report brief is part of the product input, not an optional prompt garnish.
- the report brief must explicitly represent client, audience, objective, thesis, and stakes.
- the design target is a core input, not a renderer-side theme override.
- `TemplateProfile` is the canonical output of template and brand interpretation.
- `TemplateProfile` must preserve slide dimensions and placeholder-region geometry when a PPTX template is provided.
- `TemplateProfile` must preserve source-slide exemplars for each usable PPTX layout when a customer template is provided.
- `.pptx` is the only first-class editable template input in v1.
- structured brand token files are a first-class style-system input.
- `.pdf` is a style reference in v1.
- `ExecutableMetricSpec[]` is a required planning contract before deterministic analytics execution.
- explicit left-key and right-key join contracts are required when metrics span related files.
- slide count and section structure must be evidence-driven, not fixed-spine hard-coding.
- The primary export path is Claude code execution, not a fragmented scene-graph renderer stack.
- Claude may generate final deck syntax directly, but only after deterministic ingest, template interpretation, and explicit budget enforcement.
- Full-deck tiers must still come from one accountable deck-generation pass and one durable artifact manifest.
- `data_tables.xlsx` is a first-class Basquio artifact and must be written from the same DataFrames used for charts and reported numbers.
- Haiku is a report-and-data tier, not a low-quality slide tier.
- Production runtime prompt inputs must come from tracked repository files, never workspace-only `.context` files.
- Direct deck generation should default to a light editorial slide language with a warm cream canvas, tonal ivory surfaces, ultramarine light-background logo chrome, ultramarine eyebrow/top-hairline accents, and sparse amber highlights unless the uploaded template clearly overrides it.
- In the direct code-execution path, serif display should be limited to short page-level headlines when no strong template is provided; dense slide text and card internals should use Arial-class safe fonts to reduce cross-viewer layout drift.
- Charts in the direct code-execution path should be rendered as raster image assets and embedded into the PPTX when Basquio needs one visually consistent deliverable across PowerPoint, Keynote, and Google Slides.
- Claude responds much more reliably to explicit slide geometry, forbidden layout patterns, and implementation constraints than to abstract taste language alone.
- Basquio should not ask Claude to "design a deck" from scratch on every slide; it should ask Claude to choose and fill from a small set of elite slide grammars with hard density and spacing limits.
- The direct deck path should reuse the existing slot-archetype library as its grammar source instead of maintaining a second inconsistent set of slide layouts.
- Generic smoke tests are weak signals. Stress tests should target specific historical failure classes such as recommendation-card overlap, footer collisions, or chart visibility drift.
- Prompt-only improvements can raise the floor, but `10/10` output requires rendered-page evaluation, candidate ranking, and hard publish vetoes on weak slides.
- Supabase is the default app database, auth, and storage layer.
- Inngest is no longer the primary deck-generation runtime.
- Durable database-backed run state and internal execution dispatch are the current workflow contract.

## Product Scope Memory

Initial user promise:

- upload a structured evidence package
- provide context, audience, objective, thesis, and stakes
- choose template or style direction
- optionally provide a brand file with design tokens
- receive editable PPTX plus an audit-ready markdown report and data workbook

Initial domain bias:

- executive analytical reporting for strategy, insight, research, and operating teams

## Technical Memory

- Package semantics interpretation runs before deterministic analytics execution for multi-file evidence packages.
- Deterministic analytics run from explicit executable metric plans.
- multi-file relationships must support semantically matched keys even when column names differ.
- The AI should decide what to compute; code should compute the numbers.
- Every insight must have evidence and confidence.
- Every substantive claim must resolve to `EvidenceRef[]` before render.
- `AnalyticsResult` plus derived tables are the canonical deterministic output, replacing highlight-only metric summaries.
- Rendering is gated by deterministic and semantic validation, not only schema success.
- deterministic validation and semantic critique should be persisted as separate stages before the combined revision decision.
- The semantic critic must be able to send the run back to metrics, insights, story, design, or slides before render.
- revision decisions should be durable so progress UX can explain where the workflow backtracked.
- Every completed run should emit an `ArtifactManifest`, a `QualityReport`, a `ValidationReport`, and stage traces.
- Every LLM-assisted stage should emit a `StageTrace` with prompt version, requested model, resolved model, provider, status, fallback reason, and timestamp.
- Template and brand interpretation must flow through `TemplateProfile`, not renderer-only style hacks.
- `.pptx` interpretation must materially preserve layout, placeholder, placeholder-frame, theme, and source-origin information.
- uploaded PPTX runs should instantiate the output deck against imported template slides when usable source-slide exemplars exist.
- when the client template is strong, Claude's direct PPTX should preserve the imported template constraints, and any deterministic recomposition must preserve actual rendered slide content.
- structured brand token JSON or CSS files are the current file-backed v1 path into `TemplateProfile`.
- generation is an async workflow with durable stage records, not a synchronous page request.
- users should see stage-level progress, elapsed time, and estimated remaining time while generation is running.
- queued runs should persist a reconstructable generation request envelope keyed by `jobId`.
- large browser uploads should use signed resumable transport, while smaller uploads can continue to use signed single-shot transport.
- run execution must be restartable from durable database state without depending on in-memory request context.
- Railway worker deploys must not restart on unrelated repo changes; the worker service should use focused watch patterns, a direct Node start command, and immediate shutdown handoff on `SIGTERM`.
- Railway Config-as-Code now expects current builder values; a stale `builder = "nixpacks"` entry is ignored, so the worker must use a valid builder config to keep its deploy contract in force.
- `data_tables.xlsx` is incomplete when it only contains tables; for chart-bearing runs the worker must deterministically link workbook sheets and inject native Excel companion charts before publish.
- cross-provider model fallback must be explicit and opt-in; strict structured outputs are the default contract for planning stages.
- Supabase REST queries in runtime code must stay compatible with the migrated schema; production log review is the source of truth when local assumptions drift.
- status polling and recovery logic must handle both stale queued runs and stale running-with-zero-checkpoint runs.
- The strongest quality controls for the current direct deck path are archetype contracts, negative rules, artifact QA, and rendered-page review rather than open-ended styling instructions.
- The intelligence quality moat is layered: proprietary knowledge packs, deterministic validation, prompt instructions, and an analyst feedback loop that should compound from real client corrections.
- Client-facing tone is a product constraint, not a copy polish preference. Basquio must frame hard truths as opportunities without weakening the evidence.
- Recommendation quality is its own reusable knowledge surface and must stay evidence-anchored, quantified only when directly supported, and specific about the lever, target, and expected gain.
- Analytical slides should surface supporting numbers on the same page whenever possible through co-located tables or explicit chart annotations.
- High token spend in code-execution runs is often driven by repeated `pause_turn` continuation with growing container history, not only by the initial prompt size.
- For Claude 4.6+ / Opus 4.7, `pause_turn` continuations must not end on an assistant message; Basquio must append assistant history and then an explicit user continuation prompt to stay on the live Anthropic contract.
- `deck_run_request_usage` is part of the durable execution contract: open request rows must be closed when an attempt fails, is superseded, or is interrupted by worker shutdown.
- Railway shutdown must drain before it hands off. Stop claiming new work on `SIGTERM`, keep heartbeats during the drain window, then abort and supersede only the runs still active after the timeout.
- checkpoint resume is only trustworthy when the checkpoint stores the full durable user artifact set plus any internal QA support and recovered analysis is scoped to the same attempt that produced the checkpoint.
- Cost control for the direct path must reduce turn count and context churn, not only trim wording from prompts.
- file-backed budget preflight must use telemetry-shaped cost envelopes rather than output-only projected spend.
- repair routing should prefer deterministic fixes first, then a cheap Haiku lane, and only then Sonnet-class revise when structural repair or major visual redesign is still required.
- revise acceptance must follow an ordered frontier: blocking contract issues, claim traceability, blocking visual issues, visual score, then advisory issues.
- The primary direct-worker generation pattern should be one file-backed Claude generation turn that loads the `pptx` skill from the start, not a prompt-stuffed `understand` call followed by a separate `author` call.
- workspace-origin runs must persist a typed `WorkspaceContextPack` on `deck_runs` plus a durable support packet, not only a prose workspace prelude inside `business_context`.
- the first-class workspace lineage that must survive into deck run state is `workspace_id`, `workspace_scope_id`, `conversation_id`, `from_message_id`, and `launch_source`.
- author, revise, and QA must all consume the same frozen `workspace-context.md` / `workspace-context.json` packet when a run originates from workspace context.
- The current persisted direct-worker phase list is `normalize`, `understand`, `author`, `render`, `critique`, `revise`, `export`.
- `polish` is historical and should not appear in live progress or contract schemas.
- `container_upload` evidence files should be read inside code execution, not summarized back into the prompt as dataset inventory or column dumps.
- document-led runs should upload a normalized evidence packet derived during ingest into the author container so Claude can read repaired PDF/PPTX text before attempting hostile document parsing from scratch.
- The correct production execution surface for long Basquio deck runs is a durable worker, not a Vercel request. Vercel should enqueue `deck_runs`; a Railway worker should claim and execute them.
- Supabase-backed `deck_runs.status = "queued"` is the current queue contract. A separate queue system is unnecessary while one worker claims runs atomically and stale-running runs are re-queued.
- `deck_runs` is the stable user-visible job, but recovery lineage must live in explicit `deck_run_attempts` records so retries do not become confusing top-level clone runs.
- The durable worker must run recurring stale-run recovery, not only startup recovery; otherwise a fast restart after a crash can leave interrupted runs stuck forever.
- The durable worker should heartbeat `deck_runs.updated_at` while a Claude call is in flight so the database reflects live execution rather than only phase boundaries.
- every Anthropic phase request should persist request id, usage, phase, and attempt linkage durably so failed-run cost does not require external log forensics.
- Moving generation off Vercel is not sufficient if the Anthropic client timeout remains at 15 minutes. The durable worker timeout budget must exceed real workbook generation time.
- A concrete rendered-page QA path exists: derive an internal rendered PDF from the PPTX when available, upload it to Claude as a document block, and judge the rendered pages directly. Local PDF-to-PNG rendering is for debugging and fixture inspection, not the primary production gate.
- Anthropic's token-counting endpoint must not be used with Files API references such as `source: { type: "file", file_id }` or `container_upload` blocks, and it must not be used on server-tool requests that register `code_execution_*` or `web_fetch_*`. File-backed or tool-backed phases need envelope preflight plus post-response budget enforcement from actual usage instead of preflight token counting.
- The final direct-deck publish contract requires `deck.pptx`, `narrative_report.md`, `data_tables.xlsx`, and `deck_manifest.json`. `deck.pdf` is internal QA/checkpoint support only when generated, never a required durable user-facing publish artifact.
- A failed later recovery attempt must not hide a prior successful publish. If `artifact_manifests_v2` already has `pptx`, `md`, and `xlsx`, the dashboard and finalizer should preserve the run as completed or degraded instead of making downloads disappear.
- `narrative_report.md` is a live artifact in the direct deck path and must be authored from the same canonical narrative and evidence layer as the deck, not reverse-converted from slides or PDF.
- Narrative depth must scale with the requested deck size. A 5-slide summary deck still needs an audit-ready leave-behind, but forcing a 500-line / 5,000-word report before artifact generation can starve the author turn and produce no files.
- Author messages that include uploaded evidence must put the instruction text block before all `container_upload` blocks, matching the official Anthropic code-execution file pattern.
- The direct author turn must prove evidence availability before analysis. If deterministic ingest found tabular evidence, Claude must locate and open a workbook or CSV inside the container before writing any analytical claim.
- If Claude says a required uploaded workbook is missing from the container, the run must fail at the evidence availability gate. Basquio must not salvage analysis from a manifest built after missing-evidence self-reporting.
- The direct author turn must attempt plan-quality repair before revise. Fabricated workbook sheet references, duplicate data cuts, storyline backtracking, unsupported content counts, and blocking plan-depth defects are author defects, not revise polish. Author gets one bounded full-artifact rebuild, then Basquio keeps the best structurally publishable fresh artifact set with internal advisories; if no publishable author artifact set exists, it publishes deterministic evidence artifacts instead of leaving the user with nothing.
- Durable artifact integrity is the publish contract. Missing, corrupt, or structurally invalid PPTX/MD/XLSX artifacts block publish; weak markdown depth, missing required narrative sections, lost Italian accents, weak workbook shell, missing workbook sheet links, missing native chart companions, and visual-revision findings drive bounded repair and internal advisories unless they make the artifact set unusable.
- NielsenIQ-style exports contain hierarchy subtotal traps. Any topline number must reconcile category rows against supplier rows before it is allowed into the artifacts.
- narrative markdown in v1 should be text-first and chart-free. The right trade is a reliable narrative report, not a brittle Word recreation of slide visuals.
- narrative markdown must use the same knowledge depth and copywriting rules as the deck path while expanding the explanation of what happened, why it matters, and how to act.
- When the `pptx` skill is loaded, Basquio should rely on the documented skill contract itself rather than assuming an undocumented internal presentation library implementation.
- scatter manifests must produce native editable scatter charts in `data_tables.xlsx`; the workbook injector and the TypeScript allowlist must stay aligned.
- workbook numeric precision is now a deterministic contract, not a model choice: `MetricPresentationSpec` governs NIQ-style decimal rules for workbook cells and native chart labels.
- workbook-native chart styling now persists as `ExhibitPresentationSpec`; chart bindings alone are not enough to preserve fidelity across PPT screenshots and Excel-native companions.
- the shipped workspace uploader lives in `.context/main-landing`, and that surface must use direct browser-to-Supabase uploads plus confirm-step row creation instead of raw multipart bodies through a Vercel function.
- workspace chat uploads are two-lane by contract: attached-to-chat is the immediate success state, while memory indexing is async worker work and must not be shown as an upload failure.
- workspace chat supports paste-to-attach for screenshots and files; screenshots must attach immediately, remain previewable from the chat, and enter memory through an async vision/text projection lane.
- In the current Anthropic API behavior, Sonnet and Opus use two stable authoring branches: `webFetchMode: "off"` requires explicit `{ type: "code_execution_20250825", name: "code_execution" }`, while `webFetchMode: "enrich"` should send `web_fetch` and let the API auto-inject code execution. Haiku always keeps explicit `code_execution`.
- The March 27-28 failure cluster was primarily a runtime-truth mismatch problem: speculative docs and forward-looking fixes diverged from live provider/runtime behavior faster than the code was revalidated.
- The canonical March 28 forensic truth source is `memory/march28-48h-forensic-learnings.md`.
- Current production Anthropic contract is `code_execution_20250825` with beta `code-execution-2025-08-25`; treat `code_execution_20260120` as non-canonical until live-validated.
- Current production critique and export judges are both `claude-sonnet-4-6`; do not reintroduce a weaker critique judge followed by a stricter export-only judge.
- Current production `author` / `revise` local watchdogs are disabled; stale recovery must respect active in-flight requests and meaningful progress rather than pure phase age.
- PPTX publish validation should trust the `presentation.xml` slide list over orphaned zip slide parts, and chart-image aspect checks must not treat normal chart-canvas padding as distortion.
- Git-connected Railway worker deployments install the full pnpm workspace graph from the repo root. The repo itself must declare any native build prerequisites needed by workspace dependencies instead of relying on dashboard-only packages or manual snapshot deploy rituals.

## Production Incident Memory: April 26-27, 2026, Third deck pipeline disaster (night spiral) and stabilization on `fab2aa2`

The deck pipeline was wrecked for the third time in 30 days. An agent green-lit to ship one ~200-line surgical fix shipped 9-10 commits over a single night between Apr 26 22:07 and Apr 27 04:47 CET, with 21 retry attempts and a final attempt that ended degraded. Recovery on origin/main `fab2aa2` (Apr 27 09:01 CET) reverted six "harden" / quality-passport / publish-status commits (`cf79685`, `2e417c4`, `fef8766`, `cb2f205`, `ca0af46`, `7c63d5a`) while preserving four surgical wins: `4f1b8ff` brief-data reconciliation gate (Haiku soft gate; closes the Rossella-cocktails fabrication regression class. Segafredo smoke explicitly handles MASSIMO ZANETTI vs Segafredo brand naming), `c12f6a1` queued-attempt recovery_reason preservation, `3c6e62b` deck-spec retry idempotence, `4cc8b88` deterministic workbook evidence packets. Two split-commit slivers also kept: chart-id alignment from `f5517a5` (`normalizeChartsForSlides` only; the broader `hydrateManifestFromPptxText` salvage path was reverted because it is the same band-aid the prior `6e416ce` revert removed) and zero-based slide position normalization plus workbook evidence prompt excerpt plus `POSITION CONTRACT` instruction line from `9087bb2` (the pre-retry deterministic-repair surface was reverted as the "harden" piece). Segafredo smoke on `fab2aa2` (run `e74b2c15`, attempt 23) completed in ~28 min at $4.17 with all five SHIPPABLE checks passing: data grounded, structurally valid, quality at-bar vs the Apr 23 reference deck `ec91f0d0`, time/cost within budget, reconciliation gate active. The structural lesson: **`delivery_status="degraded"` is NOT a quality signal.** Per `rules/canonical-rules.md` publish gate, only structural corruption (`pptx_present`, `pdf_present`, `pptx_zip_signature`, `pdf_header_signature`, `slide_count_positive`, `pptx_zip_parse_failed`, `pdf_parseable`) blocks publish. Lint, visual QA score, and contract violations are advisory. The reference Segafredo deck (`ec91f0d0`, Apr 23 18:52 UTC) shipped as "degraded" and the user accepted it as the working baseline; treating "degraded" as a hard failure and stacking new gates to "fix" it is the QA-treadmill anti-pattern that drove all three disasters. Canonical example: `title_claim_unverified` flagging "2023" as an unverifiable number on a date-range slide title is a false positive that the night spiral kept tightening into a publish blocker. Two hypotheses framed in the recovery prompt were investigated and proved NOT live bugs at HEAD: H1 (stale PDF for visual QA in exact-template recompose) is dead code because `shouldUseExactTemplateMode()` returns `false` unconditionally at `packages/workflows/src/generate-deck.ts:9054`; H2 (frontier_regression_rejected eats the repair budget) does not eat budget. The rollback at line 2547 is an in-memory pointer swap followed by `break;` out of the revise loop, so no extra API spend is incurred. T1 (QA treadmill cleanup) is the highest-leverage 10/10 work; it requires PRUNING the QA list, not extending it. Adding gates is the failure mode. Removing gates is the next push. NIQ guard override (`BASQUIO_NIQ_GUARD_OVERRIDE=1`) was used exactly once during recovery, scoped to the squashed-revert commit `fab2aa2`, with explicit Marco green-light because removing `getDeckPhaseBudgetCap` from `cost-guard.ts` mechanically required removing its test from `cost-guard.test.ts` (NIQ-protected file). Override is the documented escape hatch for explicitly-authorized NIQ-surface changes; the night agent's prior abuse was using it twice without green-light. Going forward: no override without per-change Marco green-light. Forensic detail: `docs/research/2026-04-27-shippable-baseline-confirmed.md`, `docs/research/2026-04-27-night-spiral-revert-plan.md`, `docs/research/2026-04-27-h1-h2-investigation.md`.

Diverse smoke confirmed pipeline generalization on `bce46ccb` (English Trade Marketing brief on Euromonitor Traditional Watches retail channels, 10 slides, 36 min, $7.48). All five SHIPPABLE checks pass; reconciliation gate generalized across language and domain by catching a "Bags and Luggage Specialists" outlet type that does not exist in the source dataset and persisting the scope adjustment into the deck (slide 4 explicit note), exactly the same regression-prevention behavior that handled MASSIMO ZANETTI vs Segafredo brand naming on the Segafredo smoke. Memory v1 work is unblocked per the rebuild-strategy doc gate.

April 27, 2026 (continued): Memory v1 Brief 2 shipped on commits `9006c22` and `ad0ee2b` (chat caching + router + four typed tools). Behind `CHAT_ROUTER_V2_ENABLED` flag (default false on Vercel). Three cached system blocks via `@ai-sdk/anthropic` `providerOptions.anthropic.cacheControl`: `STATIC_SYSTEM_PROMPT` 1h ephemeral, workspace brand pack 5m, scope context pack 5m. `apps/web/src/lib/workspace/build-context-pack.ts` split into `buildWorkspaceBrandPack` and `buildScopeContextPack`, both pure functions of stable workspace and scope state. Haiku 4.5 intent classifier in `apps/web/src/lib/workspace/router.ts` uses `structuredOutputMode: 'jsonTool'` because the live Anthropic Messages API rejects the default `output_config.format` field (verified live; documented inline). Five-enum intents: metric, evidence, graph, rule, web. Four typed retrieval tools at `apps/web/src/lib/workspace/agent-tools-typed.ts` gate by intent (queryStructuredMetric, queryBrandRule reading Brief 1 brand_guideline + workspace_rule, queryEntityFact with bi-temporal `as_of` filter, searchEvidence wrapping the existing `workspace_hybrid_search`). retrieveContextTool kept as 30-day deprecation fallback. Migration `20260428130000_chat_tool_telemetry_cache_stats.sql` adds nine nullable columns to `chat_tool_telemetry` for per-turn cache + classifier telemetry plus a partial index for `tool_name='__chat_turn__'` aggregate rows; applied via `supabase db push --linked`. Live cache smoke (`scripts/test-chat-router-v2-cache.ts`): cold turn cache_creation 18846 tokens, warm turn cache_read 18846 tokens (full prefix hit). Local gates 271/271. Production deploy on `ad0ee2b` Ready on Vercel; flag-OFF chat path byte-identical to pre-Brief-2 (verified after PUSH 2 fixed a regression where the typed-tools were leaking into the legacy tool catalogue). PUSH 3 of the 3-commit budget reserved. Phase 9 flag flip handed to operator: `vercel env add CHAT_ROUTER_V2_ENABLED production` then 5-turn smoke against `chat_tool_telemetry` rows. Forward: Brief 3 brand-guideline extraction unblocked (lights up `queryBrandRuleTool` with real data). Forensic: `docs/research/2026-04-27-brief-2-shipped.md`, `docs/research/2026-04-27-brief-2-substrate-audit.md`.

April 27, 2026: Memory v1 foundation shipped on commit `c513701` (Brief 1 of `docs/research/2026-04-25-codex-handoff-briefs.md`). Three migrations: `20260428100000_memory_architecture_foundation.sql` (workspace_rule, brand_guideline, anticipation_hints, memory_workflows, memory_workflow_runs, plus expired_at + fact_embedding columns and HNSW partial index on facts; Graphiti four-timestamp model), `20260428110000_member_scoped_rls.sql` (workspace_members + is_workspace_member helper, replaces the legacy `service_role USING (true)` policies on entities/entity_mentions/facts/memory_entries/workspace_deliverables with service-role write + member-scoped authenticated SELECT, sets `hnsw.iterative_scan = strict_order` for pgvector 0.8 RLS top-k correctness), `20260428120000_memory_audit_log.sql` (append-only memory_audit log with audit_memory_change trigger attached to workspace_rule, brand_guideline, anticipation_hints, facts, memory_entries; plus public.set_config wrapper). withActor helper at `apps/web/src/lib/workspace/audit.ts` documented but unused in Brief 1 (Briefs 2-6 adopt it on writes). MEMORY_V2_ENABLED env var defaults false; no app code reads from the new tables. Pre-merge dry-run on a production-schema copy caught one real bug: spec wrote `idx_anticipation_hints_active` with `expires_at > NOW()` in the partial index predicate, Postgres rejects non-IMMUTABLE functions there; fixed by dropping the time predicate and trusting the index column ordering. Migrations applied to production via `supabase db push --linked`; schema dump verified (7 tables, 2 enums, 7 indexes, 22 policies, 3 functions, 5 triggers). Briefs 2-6 unblocked. Forensic detail: `docs/research/2026-04-27-brief-1-substrate-audit.md` and `docs/research/2026-04-27-brief-1-foundation-shipped.md`.

## Production Incident Memory: April 21, 2026 — Discord bot silent death

- The Railway project `basquio-bot` hosts more than one service. The Discord bot AND the deck worker were both deployed inside it, both reading the SAME root `railway.toml`.
- Three commits on Apr 21 00:22-01:37 UTC (`7792727`, `d77142e`, `cbb6445`) hardened the deck worker by rewriting the root `railway.toml` start command from `pnpm worker` to `node --import tsx scripts/worker.ts`, switching to `Dockerfile.worker`, and expanding watchPatterns.
- The Discord bot service redeployed automatically with the new (deck-worker) start command. It crash-looped because the deck worker code requires `NEXT_PUBLIC_SUPABASE_URL` and the bot service had `SUPABASE_URL` set instead. 77+ restart attempts logged in the next hour.
- The bot stopped recording at Apr 20 21:14 UTC (last successful transcript). The 2-hour Apr 21 strategy session was never captured: no audio in `voice-recordings` storage, no row in `transcripts`, no recovery possible.
- Lesson: every Railway service must own a service-scoped config under its own subdirectory. Root `railway.toml` is reserved for the deck worker. The Discord bot's config lives at `apps/bot/railway.toml` from this incident forward.
- See `rules/canonical-rules.md` → "Railway / Multi-Service Deploy Rules" for the full audit-before-touch checklist.
- Watchdog requirement: any long-lived service (Discord bot, deck worker) must have a heartbeat alarm. A 30-minute silence on the bot's transcript table or worker's claim table fires an alert. Silent death over a full night is unacceptable.

## Production Incident Memory: April 25, 2026, Anthropic Skills contract outage

- The deck worker was effectively down after the Railway deployment created at `2026-04-24T16:42:43Z`, deployment `fded89be-4cec-44c8-b196-9ccb6fd44130`, commit `2b3c7d46892162b77e9394bed58af27c4ecfd45d`.
- The root bug was older. Commit `8d88511649c0525225681fc1e535aef5ee0132d3` encoded the wrong assumption that Sonnet and Opus could always rely on implicit code execution. That assumption was only survivable on the enrich branch, not on the `webFetchMode: "off"` branch.
- The prod-breaking path was activated by commit `eb0553715070942a895a7239c6f68b256f2654d6`, which introduced `webFetchMode: "off"` for cold uploads and added a unit test that asserted Opus with `webFetchMode: "off"` should return `[]` tools.
- Runtime proof from `deck_run_events`: failed runs entered `author`, recorded `skills: ["pptx", "pdf"]`, `tools: []`, and then Anthropic rejected the request with `400 invalid_request_error: container: skills can only be used when a code execution tool is enabled`.
- Runtime proof from `deck_run_request_usage`: all five failed runs after that deployment recorded zero input tokens and zero output tokens, which means the provider rejected the request envelope before model execution.
- Affected users included `rossella@basquio.com` on Segafredo and `sandy@65nation.com` on a separate leadership-team run. This was not a single-brief issue.
- Vercel and Supabase Storage were healthy during the incident. `/api/generate` kept returning `202`, storage uploads and reads were `200`, and the failure class was isolated to the worker's Anthropic request contract.
- Canonical prevention rule: any change to `anthropic-execution-contract.ts` or author/revise tool wiring must run a live cold-upload smoke on the exact no-web-fetch path before merge. `pnpm test:code-exec-no-webfetch` is the minimum required validation.
- The second April 25 failure was a validator-lane design mistake. After the contract fix, Rossella's rerun got past author and then crashed inside the new April 24 forensic validator stack. The lesson is structural: shadow validators must default to export-only, fail-soft execution. Unset or `warn` validator modes cannot be allowed on author or revise.

## Production Incident Memory: April 26, 2026, Rossella workbook missing in Claude container

- Rossella's Segafredo rerun `58eaa9a5-18d5-44dd-8158-a0dcc9874c60`, attempt 22, ran after the worker had deployed commit `094265af096be7de771f7bbeeb41c8c508538dff`.
- Runtime proof from `deck_run_events`: normalize parsed one workbook sheet, but the author response preview said `Estrazione SP Segafredo.xlsx` was not present in the container and that only the template PPTX was uploaded.
- The author then inferred from the brief and produced artifacts anyway. Revise spent additional budget on downstream lint issues, but the real root cause was missing evidence visibility before analysis.
- PDF recovery errors such as `spawn soffice ENOENT` were incidental. PDF remains internal QA support only and must not be chased as the user-facing artifact failure.
- Canonical prevention rule: author requests must send text first, then `container_upload` blocks, and must run an evidence availability gate that locates and opens every required tabular evidence file before any claim is written.
- If Claude self-reports missing required evidence, manifest salvage is forbidden. The attempt must fail with a clear evidence availability error instead of fabricating deck content from the brief.

## Production Incident Memory: April 26, 2026, Rossella manifest salvage loop

- Rossella's Segafredo rerun attempt 26 proved that the evidence upload gate was necessary but not sufficient. The author opened the workbook, then omitted attached `analysis_result.json` and returned a prose delivery summary instead.
- The pipeline accepted the durable files, synthesized analysis from `deck_manifest.json`, and entered revise with a 14-slide untrusted plan for a 10-content-slide request. Revise spent five loops and `$16.341`, then export correctly blocked publish on content slide count and fidelity issues.
- Canonical prevention rule: merged full-deck author runs must attach parseable `analysis_result.json` before revise. If it is missing or malformed after the bounded retry, fail author early. Manifest salvage is allowed only as forensic evidence or checkpoint recovery, not as the production happy path. If the paid author pass still produces no publishable artifact set, publish deterministic recovery artifacts from parsed evidence instead of throwing past the publisher and leaving the user with nothing.

## Production Incident Memory: April 26, 2026, Rossella invalid author-plan loop

- Rossella's Segafredo attempt 27 proved that a parseable `analysis_result.json` is necessary but not sufficient. The author opened the workbook and attached the analysis artifact, but the plan still referenced fabricated sheets and repeated or backtracked analytical cuts.
- The old pipeline logged these as plan validation and critique issues, then continued into render, critique, and revise. That turned an author planning failure into expensive downstream repair.
- Canonical prevention rule: author-plan validity is a pre-critique repair gate. If `analysis_result.json` fails sheet-name or plan-linearity checks, the same author container gets one bounded full-artifact rebuild. If the rebuilt analysis still fails, skip unbounded revise; keep the best structurally publishable fresh artifact set with internal advisories, or publish deterministic evidence artifacts when no publishable author artifact set exists.
- Canonical publish rule: user-facing runs must not expose internal degraded/recovery/review jargon. Final publish hard-blocks missing, corrupt, or structurally invalid durable artifacts; quality validators drive bounded repair and internal advisories unless the artifacts are unusable. Narrative depth, workbook editability, language correctness, slide-plan quality, and visual no-revision checks remain the quality contract, but they cannot turn a fresh usable artifact set into an empty user outcome. `qa_passed` and `delivery_status` derive from artifact publishability, not the internal quality passport label.

## Production Incident Memory: March 21-22, 2026

- The March 21 run `10669fc3-917b-4a4e-84cf-a3ae07493839` did not fail because the analyst could not reason. It failed because the planner emitted a hallucinated chart sheet key (`→` separators plus duplicated filename), all 10 charts loaded zero rows, and the author fell into guaranteed fallback mode.
- LLM-authored chart bindings are not trustworthy identifiers. Chart programs must bind through canonical dataset handles or normalized resolver logic, never raw freeform sheet-key strings authored by the planner.
- The March 22 run `4daa609e-0284-40f3-9146-0d5836dac7b4` proved the chart-binding fix was not enough. The run achieved `chartCoverage=100%`, but every image-chart render failed at runtime because `sharp` could not load on Vercel Linux, so the renderer silently fell back to shape-built charts.
- The intended export contract is pixel-perfect chart screenshots first, with text remaining editable. If the screenshot path is unavailable in production, that is a P0 rendering incident, not a harmless fallback.
- Scene-graph overflow and collision findings are real artifact failures, not cosmetic warnings. The March 22 deck shipped with `scene_no_overflow` and `scene_no_collisions` failing, and the resulting PPTX was visibly not agency-grade.
- PPTX and PDF are still not trustworthy if they do not share one identical visual contract. Simplified scene-graph defaults or token remapping in the PDF path can create a different product, even when both artifacts came from the same slide plan.
- A reduced or degraded deck is acceptable only when it is explicitly truthful. A full consulting-style deck must not ship after total chart-program collapse, screenshot-path collapse, or layout-integrity failure.
- Mixed-language output remains a real intelligence-quality defect. The deck language must be enforced as a hard authoring constraint, not a soft prompt hint.
- Production telemetry must be read end to end. Phase-local cost summaries can understate total run cost; the final job-finished event is the authoritative run cost.
- When production behavior and code claims disagree, trust the exported logs, artifact screenshots, and downloaded deck before trusting any self-report in commit messages.

## Design Memory

- Basquio UI should feel like an executive reporting product, not a generic SaaS admin shell.
- The canonical shell direction is a pale editorial canvas with darker technical-stage surfaces used intentionally for workflow, pipeline, and proof moments.
- Workspace scope routes are chat-first as of Apr 24, 2026: the conversation owns the main viewport, while scope metadata, stakeholders, deliverables, suggestions, and memory live in the right rail or mobile context strip.
- CostFigure is the reference for editorial rhythm, spacing discipline, and token governance, not for color direction.
- Inngest is the reference for technical confidence, dark-stage framing, and pipeline-proof presentation, not for brand cloning.
- Landing-page copy must describe the real product: evidence package plus report brief plus design target in, PPTX plus narrative markdown plus data workbook out.
- `/jobs/new` is the primary action path and should read like a report-composer surface, not a generic upload form.
- `/templates` and `/artifacts` should read as report-generation tools and deliverable surfaces, not generic cards or file lists.
- Shared visual rules should live in the web token layer first, then page structure, instead of ad hoc one-off component styling.

## Process Memory

Before implementation:

1. read `docs/vision.md`
2. read `docs/architecture.md`
3. read this file
4. run `pnpm qa:basquio`

When production incidents happen:

1. inspect exported web logs
2. inspect exported database logs
3. compare runtime queries against migrations
4. only then trust or revise the progress UI explanation

Template fidelity lesson:

- imported client PPTX profiles must not inherit Basquio defaults; if `coverBg`, logo paths, or callout colors look like house-style values, the extractor is contaminated
- imported client PPTX profiles may carry extracted `brandTokens.logo.imageBase64`, `brandTokens.logo.position`, and `brandTokens.decorativeShapes`; those fields are part of the live template-fidelity contract and must not be stripped from the schema
- imported client PPTX `brandTokens.injection.masterBackground` is advisory only; treat it as live deck canvas only if it matches palette hints or is clearly brand-aligned. Neutral placeholder fills must be ignored at extraction time and again at render time.
- the current manifest is not rich enough to rebuild final slides from metadata alone; manifest-only recomposition can preserve geometry while destroying actual slide content
- until full rendered slide content is carried explicitly, prefer clean prompt palette injection over post-hoc PPTX reconstruction
- the worker deploy boundary must stay separate from the Next web build. `Dockerfile.worker` must not depend on `pnpm run build`, and worker runtime helpers must not live under `apps/web` unless the worker service intentionally accepts web-coupled deploys.
- free-plan custom-template runs must persist a durable checkout draft before redirecting to Stripe so `/jobs/new` can resume safely after payment without losing uploaded files or the brief
- the completion surface should show durable slide previews before download; preview thumbnails are best-effort assets derived at publish time and stored on `artifact_manifests_v2.preview_assets`
- `artifact_download_events` is the durable truth for whether a completed run was actually opened, and reminder emails should key off that instead of page visits
- reminder UX should stay tied to concrete user states: completed-with-no-download, uploaded-template/no-run, and low-credit after a successful debit
- sample-data onboarding is a valid acquisition path for Basquio because many signups arrive without a workbook ready; the sample run should live directly inside `/jobs/new`, not on a detached marketing flow
- a full-deck author turn that spends model time but returns no required files should get one bounded missing-file retry on Opus/Sonnet as well as Haiku; do not treat that recovery path as Haiku-only
- bare provider/tool interruption markers such as `terminated`, `container_expired`, `execution_time_exceeded`, `too_many_requests`, and tool-result `unavailable` are transient provider failures and must flow into the superseding-attempt recovery path, not the terminal internal-error bucket

When architecture changes:

1. update decision log
2. update this memory
3. update contracts
4. rerun QA

## Open Questions

- exact v1 template authoring guidelines for customer PPTX uploads
- how strict the brand-token validator should become beyond the current JSON/CSS token path
- whether Basquio preview UI should use client ECharts or Recharts
- whether Vega-Lite becomes necessary for specific analytical chart families
- whether Basquio launches inside Loamly or as a separate repo first
- workspace-origin reruns should prefer the persisted `deck_runs.workspace_context_pack` from the source run over browser-posted workspace context payloads.
- server-side workspace-pack canonicalization must bind `sourceFiles` and cited source ids only to real attached `source_files` rows inside the same `organization_id` / `project_id` boundary before enqueue.
- client-friendly copy is a valid goal only after intelligence non-negotiables pass. The hard blockers are: no invented targets, no invented competitor motives, no missing focal-brand positioning on competitor slides, no chart/claim metric mismatch, no distribution opportunity without productivity proof, no value-led story when inflation makes volume the real signal, and no redundant analytical cut.
- NIQ promo decks must be built as a drill-down matrix across market, channel, retailer/area, format, competitor, promo mechanics, and productivity. SCQA is only the narrative wrapper.
- narrative linearity for NIQ decks means analytical branches stay contiguous. Jumping from segments to channels and then back to segments is a planner failure unless the revisit is an explicit synthesis/comparison or a clearly deeper follow-up.
- deterministic NIQ decimal policy must override heuristic formatting when the metric family is known: value/volume/packs 0 unless scaled, distribution/promo pressure/TDP 0, intensity index 1, shares and discount depth 1, prices 2, indices 0, rotation/ROS/productivity 1, with variations inheriting base precision.
- quality hardening should follow eval-driven development: automated/code-based checks first, LLM judges only with explicit rubrics, and regression cases treated as release blockers rather than allowing style wins to hide intelligence regressions.
- superseded attempts are terminal lineage, not active lineage. Any recovery or ownership-loss path must stamp the old attempt row with `completed_at` and close request rows so forensic audits never show ghost-running attempts after handoff.
- workbook-native charts are not enough on their own; `data_tables.xlsx` is a user-facing consulting artifact and requires a deterministic presentation shell: README/index sheet, freeze panes, styled headers, styled Excel tables, explicit column widths, hidden helper ranges outside the visible chart panel, and reserved right-panel chart placement to avoid overlaps.
