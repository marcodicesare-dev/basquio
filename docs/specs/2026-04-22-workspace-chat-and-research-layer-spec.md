# Workspace Chat + Research Layer Implementation Spec

**Date:** 2026-04-22
**Status:** Ready for implementation agent
**Owner (product):** Marco
**Supersedes:** nothing; this is a build-out spec, not a re-architecture

This spec covers two coupled capabilities the workspace needs in order to be what Marco has described as "the smartest assistant that makes FMCG and market research work easier, then produces the deck":

1. **Chat-as-ingest-and-edit layer.** Users paste emails, transcripts, notes; chat extracts entities and facts with inline approval; chat can also edit stakeholders, rules, style preferences via natural language. Giulia-grade UX: no click-through to side panels.
2. **Research-backed deck generation.** The deck pipeline runs its own curated scraping of trusted FMCG sources before the author call. Users do not paste URLs. The system decides what to scrape from a seed catalog of Italian trade press, retailer press, and stats bodies.

Both sit on top of what is already shipped. This spec does not rebuild anything that exists; it extends.

---

## 0. Read first

Implementation agent must read, in order:

- `docs/working-rules.md` — no em dashes, no slop, no emojis, spec before build, research before strategy
- `memory/feedback_design_golden_rules.md` — five non-negotiable design rules locked 2026-04-22
- `rules/canonical-rules.md` — evidence spine, single-call architecture, container_upload cost rules, EvidenceRef discipline
- `docs/specs/2026-04-22-insight-regression-promo-storytelling-and-niq-decimal-spec.md` — **landed on main 2026-04-22 22:38.** Hardens NIQ promo storytelling contract, claim-to-chart binding, deterministic decimal policy, eval-driven hardening. This spec and that one share intelligence-package and workflows-package surfaces. Both must coexist.
- `docs/domain-knowledge/niq-promo-storytelling-playbook.md` — the mandatory promo cascade (category baseline → value/volume/price → promo/no-promo → discount tiers → channel/area → focal-vs-competitor → WD Promo mechanics → synthesis). Rossella's brief type.
- `docs/domain-knowledge/niq-decimal-policy.md` — deterministic NIQ metric formatting. Any scraped evidence that emits numbers must respect this.
- `packages/workflows/src/anthropic-execution-contract.ts` — canonical Anthropic tool/beta/skill contract
- `packages/intelligence/src/insights.ts:26-152` — the EvidenceRef schema and validation gate this spec relies on
- `packages/intelligence/src/claim-chart-alignment-validator.ts` — **added 2026-04-22.** Validates rotation/price/distribution claims against hero-chart metrics. Scraped sources that back rotation/price/distribution claims must also pass this validator.
- `apps/web/src/lib/workspace/agent-tools.ts` — the 7 existing chat tools (pattern you extend)
- `apps/web/src/lib/workspace/extraction.ts:119-160` — the entity/fact extractor you reuse
- `apps/web/src/lib/workspace/build-context-pack.ts` — how stakeholders/memory/rules get into the deck
- `apps/web/src/lib/workspace/synthesize-brief.ts` — brief synthesis today
- `scripts/contact-enrichment.ts:868-919` — Firecrawl client pattern already in repo
- `memory/canonical-memory.md` — updated 2026-04-22 with client-friendly-subordinate rule, promo drill-down matrix, branch contiguity, decimal policy
- `docs/decision-log.md` — entry "April 22, 2026 — Client-friendly copy is gated by intelligence non-negotiables"
- `docs/2026-04-22-session-handoff.md` and `docs/2026-04-21-team-call-reconstructed.md` — the strategic context that motivates this

**Branch state, resolved 2026-04-23.** Branch `v2-research-memo` has been fast-forwarded to `origin/main` at commit `334a8da`. The NIQ promo hardening (`22406d5`) and import cleanup (`334a8da`) are now in this branch's tree. This spec and its sibling shell-UX spec are committed on top of that state. Implementation can run against the current working tree without re-merging. File:line citations in §2 have been verified against the post-merge state.

Do not skip the reads. This spec assumes you know what's already there.

---

## 1. Executive summary

Three coupled deliveries, one shared substrate:

| Stream | Input | Output | New code path |
|---|---|---|---|
| A. Chat ingest and edit | Pasted text or URLs in chat | New entities, facts, memory entries, stakeholder edits, rule edits — with inline approval | 6 new AI SDK v6 tools, 1 system prompt revision, 1 approval-card UI component |
| B. Research layer | Brief + workspace context at deck-run time | **Dual write:** `EvidenceRef[]` for the current deck **AND** persistent `knowledge_documents` / `knowledge_chunks` / `entities` / `entity_mentions` / `facts` in the workspace graph. Scraped via Firecrawl `/map` + `/batch-scrape`. | New `packages/research/` package, 3 migrations, 1 new phase in `generate-deck.ts` between `normalize` and `understand`, reuse of existing `processWorkspaceDocument()` extraction pipeline |
| C. Source catalog UI | Seed catalog of 21 verified Italian sources | Read-only browser in workspace settings | 1 page, 1 API route, 1 migration |

Shared substrate: `EvidenceRef` contract at `packages/intelligence/src/insights.ts:26-39`. Both streams produce `EvidenceRef` and let the existing validator at `insights.ts:115-152` enforce grounded output. No new validator code. No new evidence contract.

**Dual-write architecture for scrapes (load-bearing decision).** Every scraped article serves two coupled purposes and must be written to both places in one pass:

1. **Per-run evidence ref** materializes the scrape for the current deck's `analyticsResult.evidenceRefs` so the validator accepts claims citing `[firecrawl:<hash>]`.
2. **Persistent workspace knowledge** writes the same article as a `knowledge_documents` row with `kind='scraped_article'` and runs the shipped `processWorkspaceDocument()` pipeline so entities, mentions, facts, and chunks populate the graph.

Why both, not one: if only ephemeral, the workspace doesn't compound and every Kellanova deck re-scrapes Kellanova; that kills the memory-as-moat thesis from the handoff §1 aha #2 and #3. If only persistent, the deck pipeline has to re-query the graph at generation time and risks the validator dropping scraped claims because they're not in the run's evidence Set. Both paths in one pass: the current deck has its evidence refs materialized, future decks reuse via the graph, chat surfaces scraped facts via `retrieveContext`, Week 10 Kellanova research cost trends toward zero.

This enables a **graph-first planner** (§5.2): before scraping, the planner checks the workspace knowledge graph for existing coverage and only fires Firecrawl on the gaps. Glean Enterprise Graph pattern applied to external sources.

Architecture for B is **Pattern A (pre-fetch planner)** per the research memo companion. Rejected Pattern B (agentic ReAct) because of single-call cost explosion; rejected Pattern C (bounded refinement) for v1 because the planner isn't known to miss query types yet. Harvey, Rogo, Hebbia, OpenEvidence all use Pattern A. See `docs/2026-04-22-research-layer-sota.md` (to be created as companion; this spec self-contains the decision).

---

## 2. Forensic audit of existing code (verbatim, cite this when you touch it)

What is already shipped and must NOT be rebuilt:

### 2.1 Chat surface

- `apps/web/src/components/workspace-chat/Chat.tsx:4,211-241` — `useChat` from `@ai-sdk/react` with `DefaultChatTransport`. Posts to `/api/workspace/chat`. Includes `scope_id` in body.
- `apps/web/src/app/api/workspace/chat/route.ts:76-86` — Server uses `streamText({model, system, tools, messages, stopWhen: stepCountIs(10)})`. Persists conversation on `onFinish`.
- `apps/web/src/lib/workspace/agent.ts` — exports `BASQUIO_MODEL_ID = "claude-sonnet-4-5"` and `SYSTEM_PROMPT` (full prompt in file).
- `apps/web/src/lib/workspace/agent-tools.ts:76-380` — seven shipped tools: `readMemoryTool`, `teachRuleTool`, `retrieveContextTool`, `showMetricCardTool`, `showStakeholderCardTool`, `analyzeAttachedFileTool`, `listConversationFilesTool`. Registered via `getAllTools(ctx)` at line 370.

### 2.2 Extraction pipeline

- `apps/web/src/lib/workspace/extraction.ts:119-160` — `extractEntitiesFromDocument(text, filename)` returns `EntityExtractionResult`. Works on any text string. Already server-side exported.
- `apps/web/src/lib/workspace/process.ts:36-196` — `processWorkspaceDocument(documentId)` runs the full pipeline. Calls `extractEntitiesFromDocument` at line 148, `persistExtraction` at line 149.
- `persistExtraction()` dedupes entities by `(type, normalized_name)`, upserts to `entities`, writes `entity_mentions` and `facts`. Line 290-328 in `process.ts`.

### 2.3 Stakeholders

- Stakeholders are `entities` rows with `type='person'`. Metadata holds `preferences`, `role`, `company`, `linked_scope_id`.
- `apps/web/src/lib/workspace/people.ts:31-277` — `listWorkspacePeople`, `createWorkspacePerson`, `updateWorkspacePerson`, `getWorkspacePerson`, `getWorkspacePersonProfile`.
- API routes: `GET /api/workspace/people`, `GET /api/workspace/people/[id]`. No POST/PATCH routes for stakeholder edit yet.
- UI component: `apps/web/src/components/workspace-chat/ToolChips.tsx:276-307` renders `StakeholderCard` inline.

### 2.4 Memory

- `memory_entries` table: `id, workspace_id, workspace_scope_id, scope, memory_type, path, content, metadata, created_at, updated_at`.
- `memory_type` ∈ `procedural | semantic | episodic`.
- `apps/web/src/lib/workspace/memory.ts` — full CRUD: `createMemoryEntry`, `listMemoryEntries`, `updateMemoryEntry`, `archiveMemoryEntry`, `togglePinMemoryEntry`.
- API routes exist: `GET|POST /api/workspace/memory`.
- Chat tool `teachRule` writes memory on explicit user "remember" request only.

### 2.5 Brief synthesis and deck composer

- `apps/web/src/components/workspace-generation-drawer.tsx` — right-side drawer; user edits synthesized brief inline; triggers deck run.
- `apps/web/src/components/workspace-generation-status.tsx` — sticky pill over chat; polls `/api/v2/runs/[runId]` every 5s.
- `apps/web/src/lib/workspace/synthesize-brief.ts:1-191` — Haiku call that reads conversation + workspace context pack, returns `{title, objective, narrative, audience, thesis, stakes, slideCount}`. Fallback to minimal brief if API fails.
- **Gap at line 54-102:** `synthesizeBrief` uses `pack.stakeholders[].name` and `.role` but does NOT use `.preferences.structured` (deck length, tone, language, chart preference). Pack has the data; synthesis prompt ignores it.

### 2.6 Context pack

- `apps/web/src/lib/workspace/build-context-pack.ts:135-402` — `buildWorkspaceContextPack()` pulls scope, memory entries, people (filtered to linked_scope_id or name match), style contract, rendered brief prelude.
- Schema at `packages/types/src/workspace-context.ts` (derived from `workspaceContextPackSchema` in spec), includes: `scope, stakeholders[], rules{workspace,analyst,scoped}, citedSources[], sourceFiles[], lineage, styleContract, renderedBriefPrelude, schemaVersion`.
- Flow: `POST /api/workspace/generate` → parse pack → RPC `enqueue_deck_run` → writes `deck_runs.workspace_context_pack` JSONB + hash.
- Port-louis (deck generation service) consumes pack from `deck_runs.workspace_context_pack`.

### 2.7 Evidence refs and validators

- `packages/intelligence/src/insights.ts:26-39` — `llmEvidenceRefSchema`: `{id, sourceFileId, fileName, fileRole, sheet, metric, summary, confidence, sourceLocation, rawValue, derivedTable, dimensions}`.
- `packages/intelligence/src/insights.ts:115-152` — `rankInsights()` filters against `analyticsResult.evidenceRefs` Set; drops any insight whose refs aren't in the set. This is the grounding gate.
- `packages/intelligence/src/analytics.ts:30-72` — `computeAnalytics()` returns `AnalyticsResult` with `evidenceRefs: EvidenceRef[]`.
- `packages/intelligence/src/claim-chart-alignment-validator.ts` (NEW, landed 2026-04-22) — `validateClaimChartAlignment(slide, sheet)` catches three regressions: rotation/productivity claim without rotation-metric chart, price-led claim without price-mechanics chart, distribution-opportunity claim without productivity proof. Emits `claim_chart_metric_mismatch` and `distribution_claim_without_productivity_proof` violations.

**Implication for research-layer integration.** Scraped articles that back claims with a rotation / price-led / distribution opportunity angle flow through the same claim-to-chart validator as uploaded-data claims. The validator operates on slide-plus-sheet; scraped evidence contributes to the slide's `rawValue` citation but the chart still needs to prove the claim. Do not route around this validator. If a scraped article says "rotation collapsed on private label in Coop" and the deck renders that as a slide, the hero chart must show rotation or ROS, not sales value. The research layer does not suppress the validator; it extends the evidence pool the validator checks against.

### 2.8 Deck phases

Canonical phases per `packages/workflows/src/generate-deck.ts:141`:

```
normalize → understand → author → render → critique → revise → export
```

`understand` takes the analytics result and plans slides. `author` generates the deck. This spec inserts a new `research` phase between `normalize` and `understand` (details in §5).

### 2.9 External intelligence clients (Firecrawl and Fiber)

**Firecrawl (trade press + open web).**

- `scripts/contact-enrichment.ts:868-919` — `firecrawlLinkedinFallback()` calls `https://api.firecrawl.dev/v2/search` with Bearer token from `getFirecrawlApiKey()`. Rate limiter via `firecrawlLimiter`. Pattern reusable.
- `scripts/research-weak-contacts.ts:197-200` and `scripts/enrichment-pass2.ts:114-123` — same pattern.
- Firecrawl is NOT in the deck pipeline today. `packages/workflows/src/anthropic-execution-contract.ts:40-59` builds `[web_fetch_20260209]` only (plus `code_execution_20250825` explicit for Haiku).

**Fiber AI (LinkedIn intelligence, ToS-safe).**

- `scripts/contact-enrichment.ts:809-863`: `lookupFiberByEmail()` and `lookupFiberPosts()` call Fiber endpoints with `FIBER_API_KEY` from env, base URL `process.env.FIBER_BASE_URL ?? "https://api.fiber.ai"`. Rate-limited via `fiberLimiter`. Retry discipline via `withRetries()`.
- `scripts/enrichment-pass2.ts:644-722`: uses three endpoints, `/v1/email-to-person/single`, `/v1/validate-email/single`, `/v1/linkedin-live-fetch/profile-posts`.
- `scripts/enrich-fra-contacts.ts:813`: same pattern as contact-enrichment.ts.
- Fiber covers 850M profiles plus 40M companies plus a real-time posts endpoint plus an MCP server. Pricing 300 to 2,400 USD per month. Bearer token API.
- Fiber is NOT in the workspace pipeline today. §5.7 below covers the routing plan.

**Critical ToS posture (verified 2026-04-23).** Firecrawl-stealth-scraping of LinkedIn is ToS-risky. Proxycurl was shut down July 2025 after a LinkedIn lawsuit. Apollo and Seamless were banned March 2025. The hiQ v LinkedIn precedent was neutralized by the 2022 settlement. Fiber stays on the right side of the legal line by operating as a LinkedIn-partnered API rather than scraping public pages. Any LinkedIn data path in the research package MUST route through Fiber, not Firecrawl. See §5.7.

### 2.10 Scoping

- `apps/web/src/lib/workspace/constants.ts:14-17` defines `BASQUIO_TEAM_WORKSPACE_ID = "15cc947e-70cb-455a-b0df-d8c34b760d71"` and its deprecated alias `BASQUIO_TEAM_ORG_ID`.
- `apps/web/src/lib/workspace/workspaces.ts:49-57` — `getCurrentWorkspace()` hardcodes this singleton.
- V2 `workspaces` table (`supabase/migrations/20260420120000_v2_workspace_tables.sql:11-25`) supports `visibility ∈ (private, team, shareable_with_token)` but nothing writes private workspaces today.

**Per-user private workspace is NOT in this spec.** It's a separate ~90-line delta (see `docs/2026-04-22-session-handoff.md` earlier work). This spec assumes the team workspace is the dogfood surface. If Marco wants private workspaces first, that migration ships before this spec is executed.

---

## 3. Data model additions

Four migrations. All additive, no table rewrites.

**Summary:**
- `source_catalog` — curated per-workspace source list
- `source_catalog_scrapes` — 24h scrape-cost dedup cache, links to `knowledge_documents`
- `research_runs` — telemetry per research execution
- `knowledge_documents` column extension — foreign key to `source_catalog` for provenance

**Plus one seed migration** with 18 verified-active + 7 pending-verification (paused) + 6 permanently-paused Italian sources.

### 3.1 Migration: `20260423000000_source_catalog.sql`

```sql
CREATE TABLE public.source_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  tier INT NOT NULL CHECK (tier BETWEEN 1 AND 5),
  language TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'trade_press','retailer','association','stats','market_research','brand','news','cross_reference','linkedin_fiber'
  )),
  domain_tags TEXT[] NOT NULL DEFAULT '{}',
  crawl_patterns JSONB NOT NULL DEFAULT '{}',
  trust_score INT NOT NULL CHECK (trust_score BETWEEN 0 AND 100) DEFAULT 70,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','broken','removed')),
  last_verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, url)
);

CREATE INDEX source_catalog_workspace_tier_idx ON public.source_catalog(workspace_id, tier, status);
CREATE INDEX source_catalog_host_idx ON public.source_catalog(host);
CREATE INDEX source_catalog_domain_tags_idx ON public.source_catalog USING GIN (domain_tags);
```

`crawl_patterns` JSONB example:

```json
{
  "crawl_allow": ["/news/.*", "/press/.*", "/comunicati/.*", "/articoli/.*"],
  "crawl_deny": ["/login/.*", "/account/.*", "/archive/.*\\?year=(19|200[0-9])"],
  "map_search_hint": "news",
  "max_pages_per_crawl": 200,
  "requires_enhanced_proxy": false,
  "language_detect_selector": "html[lang]"
}
```

Per-source crawl config. Seed with defaults that match each site's path shape.

### 3.2 Migration: `20260423000100_source_catalog_scrapes.sql`

```sql
CREATE TABLE public.source_catalog_scrapes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.source_catalog(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  title TEXT,
  published_at TIMESTAMPTZ,
  content_markdown TEXT NOT NULL,
  content_tokens INT,
  language TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  firecrawl_endpoint TEXT NOT NULL CHECK (firecrawl_endpoint IN ('scrape','crawl','batch-scrape','map','search')),
  firecrawl_credits_used NUMERIC(10,4),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (url_hash)
);

CREATE INDEX source_catalog_scrapes_source_idx ON public.source_catalog_scrapes(source_id, fetched_at DESC);
CREATE INDEX source_catalog_scrapes_workspace_idx ON public.source_catalog_scrapes(workspace_id, fetched_at DESC);
CREATE INDEX source_catalog_scrapes_content_hash_idx ON public.source_catalog_scrapes(content_hash);
```

`expires_at` defaults to `now() + interval '24 hours'`. Dedupe by `content_hash` catches same article republished under a different URL.

### 3.3 Migration: `20260423000200_research_runs.sql`

```sql
CREATE TABLE public.research_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  deck_run_id UUID REFERENCES public.deck_runs(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.workspace_conversations(id) ON DELETE SET NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('deck_run','chat_tool','manual')),
  brief_summary TEXT,
  plan JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','planning','fetching','indexing','completed','failed','cancelled')),
  scrapes_attempted INT NOT NULL DEFAULT 0,
  scrapes_succeeded INT NOT NULL DEFAULT 0,
  firecrawl_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  evidence_ref_count INT NOT NULL DEFAULT 0,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX research_runs_deck_run_idx ON public.research_runs(deck_run_id);
CREATE INDEX research_runs_workspace_created_idx ON public.research_runs(workspace_id, created_at DESC);
```

Plan JSONB matches the `ResearchPlan` shape in §5.2. Telemetry source for the UI in §7.3.

### 3.4 Migration: `20260423000300_knowledge_documents_source_provenance.sql`

Add provenance columns to the existing `knowledge_documents` table so scraped articles link back to their `source_catalog` entry without breaking the upload-flow rows (which leave the new columns NULL).

```sql
ALTER TABLE public.knowledge_documents
  ADD COLUMN source_catalog_id UUID REFERENCES public.source_catalog(id) ON DELETE SET NULL,
  ADD COLUMN source_url TEXT,
  ADD COLUMN source_published_at TIMESTAMPTZ,
  ADD COLUMN source_trust_score INT;

CREATE INDEX knowledge_documents_source_catalog_idx
  ON public.knowledge_documents(source_catalog_id)
  WHERE source_catalog_id IS NOT NULL;

CREATE INDEX knowledge_documents_kind_idx
  ON public.knowledge_documents(workspace_id, kind);
```

Why `ON DELETE SET NULL`: deleting a `source_catalog` entry must NOT delete historical knowledge derived from it. The article and its extracted facts remain in the workspace; the source pointer is just nulled. This is a conscious break from cascade behavior because workspace knowledge is more valuable than catalog hygiene.

The `kind` index supports the graph-first planner's filter on `kind='scraped_article'` vs uploaded files.

### 3.5 Seed migration: `20260423000400_source_catalog_seed.sql`

Insert 31 Italian and UK FMCG/CPG sources into `source_catalog` scoped to `BASQUIO_TEAM_WORKSPACE_ID`: **18 verified-active** plus **7 pending-verification (seeded paused)** plus **6 permanently paused**. The 18 active are verified scrapable with Firecrawl on 2026-04-22. The 7 pending were named by Rossella on 2026-04-23 and must pass a Day 2 scrapability smoke run before flipping to active. The 6 permanently paused need enhanced-proxy or chunking strategies before they can be enabled.

**Active (18):**

| Tier | Host | Source type | Language | URL | Crawl allow |
|---|---|---|---|---|---|
| 1 | mark-up.it | trade_press | it | https://mark-up.it | `/articoli/.*`, `/news/.*` |
| 1 | foodweb.it | trade_press | it | https://foodweb.it | `/news/.*`, `/notizie/.*` |
| 1 | foodaffairs.it | trade_press | it | https://foodaffairs.it | `/.*` (small site, crawl all) |
| 1 | retailfood.it | trade_press | it | https://retailfood.it | `/news/.*` |
| 1 | agrifoodtoday.it | trade_press | it | https://agrifoodtoday.it | `/news/.*`, `/attualita/.*` |
| 1 | freshplaza.it | trade_press | it | https://freshplaza.it | `/news/.*`, `/article/.*` |
| 2 | federalimentare.it | association | it | https://federalimentare.it | `/comunicati/.*`, `/news/.*` |
| 2 | federdistribuzione.it | association | it | https://federdistribuzione.it | `/news/.*`, `/pubblicazioni/.*` |
| 2 | centromarca.it | association | it | https://centromarca.it | `/news/.*` |
| 2 | bevitalia.it | association | it | https://bevitalia.it | `/news/.*`, `/comunicati/.*` |
| 3 | ismea.it | stats | it | https://ismea.it | `/flex/cm/pages/ServeBLOB.php/.*`, `/news/.*`, `/.*\\.pdf` |
| 3 | istat.it | stats | it | https://istat.it | `/it/archivio/.*`, `/comunicato-stampa/.*` |
| 3 | mise.gov.it | stats | it | https://mise.gov.it | `/it/stampa/.*`, `/it/notizie-stampa/.*` |
| 4 | nielsen.com | market_research | en | https://nielsen.com | `/insights/.*`, `/news-center/.*` |
| 4 | euromonitor.com | market_research | en | https://euromonitor.com | `/article/.*`, `/press-releases/.*` |
| 5 | just-food.com | cross_reference | en | https://just-food.com | `/news/.*`, `/analysis/.*` |
| 5 | fooddive.com | cross_reference | en | https://fooddive.com | `/news/.*` |
| 5 | foodnavigator.com | cross_reference | en | https://foodnavigator.com | `/Article/.*` |

Trust scores: Tier 1-2 → 85, Tier 3 → 90 (official stats), Tier 4 → 75, Tier 5 → 65. `domain_tags` seeded per source (e.g., gdo, retail, horeca, private_label, innovation, regulatory, beverage, fresh, ingredients).

**Active (+7 added 2026-04-23 from Rossella structured feedback, pending crawl verification):**

Seed all seven with `status='paused'` and `metadata.paused_reason = 'pending_verification_2026-04-23'`. The Day 2 fetcher work flips each to `status='active'` only after a successful `/v2/map` + `/v2/batch-scrape` smoke run against the source. If scrapability fails, keep as paused with the real reason and route to the implementation agent's watch list.

| Tier | Host | Source type | Language | URL | Crawl allow (default, refine on verification) |
|---|---|---|---|---|---|
| 1 | cibuslink.it | trade_press | it | https://cibuslink.it | `/news/.*`, `/articoli/.*` |
| 2 | ilsole24ore.com | news | it | https://ilsole24ore.com | `/art/.*`, `/notizie/.*` |
| 1 | distribuzionemoderna.info | trade_press | it | https://distribuzionemoderna.info | `/news/.*`, `/articoli/.*` |
| 1 | gdonews.it | trade_press | it | https://gdonews.it | `/news/.*`, `/notizie/.*` |
| 1 | largoconsumo.info | trade_press | it | https://largoconsumo.info | `/news/.*`, `/articoli/.*` |
| 5 | thegrocer.co.uk | cross_reference | en | https://thegrocer.co.uk | `/news/.*`, `/article/.*` |
| 5 | retail-week.com | cross_reference | en | https://retail-week.com | `/news/.*`, `/article/.*` |

Rossella/Veronica async review window: 7 days from this spec patch. Expected swaps include replacing lower-trust rows with sources they actually cite inside NIQ/Mondelez.

**Paused (6) — verified problematic 2026-04-22, inserted with `status='paused'` and `metadata.paused_reason` for observability:**

| Host | Tier | Paused reason | Future fix |
|---|---|---|---|
| gdoweek.it | 1 | Token overflow (>50K chars per page) | Chunked fetch via `onlyMainContent + maxAge` tuning |
| ansa.it | 5 | Token overflow (>126K chars per page) | Chunked fetch + chunk-level extraction |
| confcommercio.it | 2 | HTTP 403 to default user-agent | Enhanced-proxy tier (+4-5 credits/page) |
| linea-verde.it | 1 | Site maintenance redirect | Re-verify monthly; un-pause when live |
| bva-doxa.it | 4 | Domain expired | Remove from catalog or replace with successor |
| confindustria.it | 2 | Request timeout | Enhanced-proxy + longer waitFor |

Excluded from v1 fetching by `status='paused'` filter in `listActiveCatalog()`. UI in §7 shows them grouped as "Available with upgrade" so the user knows the gap exists but understands why they're off.

---

## 4. Firecrawl usage map

Per the Firecrawl v2 docs audit (companion memo), these are the exact endpoint roles:

### 4.1 `/v2/map` — URL discovery, first call per source

Called per source during research run. Purpose: discover article URLs without paying per-page scrape cost.

Request shape:

```ts
{
  url: source.url,
  search: brief_derived_keywords.join(" "),  // e.g., "snack salati Kellanova lancio 2026"
  sitemap: "include",
  includeSubdomains: true,
  ignoreQueryParameters: true,
  limit: source.crawl_patterns.max_pages_per_crawl ?? 200,
  location: { country: "IT", languages: [source.language] },
  ignoreCache: false
}
```

Cost: 1 credit flat per call.

Returns `{links: [{url, title, description}]}`. Client-side filter: regex-match against `source.crawl_patterns.crawl_allow` and anti-match against `crawl_deny`. Cap to `top N` by title/description keyword score against the brief.

### 4.2 `/v2/batch-scrape` — bulk scrape of mapped URLs

Called per research run on the URLs filtered from `/map`. Async with webhook.

Request shape:

```ts
{
  urls: filteredUrls,       // typically 3-15 URLs per source
  formats: ["markdown"],
  onlyMainContent: true,
  waitFor: 0,
  blockAds: true,
  proxy: source.crawl_patterns.requires_enhanced_proxy ? "enhanced" : "auto",
  location: { country: "IT", languages: [source.language] },
  maxConcurrency: 5,
  ignoreInvalidURLs: true,
  webhook: { url: "{worker_callback_url}/firecrawl-batch", headers: {"x-basquio-run": researchRunId} }
}
```

Cost: 1 credit/URL base + `requires_enhanced_proxy` + 4-5 if applicable.

Poll `GET /v2/batch-scrape/{id}` until `status === 'completed'`. Or listen for webhook (implementation detail — poll is simpler for v1).

### 4.3 `/v2/crawl` — deep recursive crawl, reserved for catalog onboarding

Not used per-deck. Used once per source to seed `source_catalog_scrapes` with historical articles on catalog onboarding (admin action). Respects `includePaths`, `excludePaths`, `ignoreRobotsTxt: false` (we always respect robots).

Request shape (for catalog onboarding only):

```ts
{
  url: source.url,
  includePaths: source.crawl_patterns.crawl_allow,
  excludePaths: source.crawl_patterns.crawl_deny,
  limit: source.crawl_patterns.max_pages_per_crawl ?? 500,
  maxDiscoveryDepth: 4,
  crawlEntireDomain: false,
  sitemap: "include",
  maxConcurrency: 10,
  scrapeOptions: {
    formats: ["markdown"],
    onlyMainContent: true,
    blockAds: true,
    proxy: source.crawl_patterns.requires_enhanced_proxy ? "enhanced" : "auto",
    location: { country: "IT", languages: [source.language] }
  }
}
```

Cost: 1 credit/page. Budget: max 500 pages per source per onboarding.

### 4.4 `/v2/search` — cross-catalog search for open queries

Used when the planner decides the brief needs cross-catalog search (e.g., "competitor launched product X this week" and we don't know which source covers it). Scoped to catalog hosts via `site:` operator:

```ts
{
  query: `${queryText} (${catalogHosts.map(h => `site:${h}`).join(" OR ")})`,
  limit: 20,
  tbs: "qdr:m",                  // last month, configurable from freshness_window
  country: "IT",
  sources: ["web", "news"],
  scrapeOptions: {
    formats: ["markdown"],
    onlyMainContent: true,
    blockAds: true
  }
}
```

Cost: 0.2 credits × results + 1 credit × scraped results.

### 4.5 `/v2/scrape` — single URL fallback

Used only when the planner identifies a specific URL (from brief context or an earlier Firecrawl search) and wants the full article. Request matches §4.1 shape but for single URL.

### 4.6 What we do NOT use in v1

- `/v2/extract` (Zod schema extraction): not needed, we only need markdown; schema extraction is relevant if we later want structured pricing tables or SKU data
- `/v2/interact` (dynamic interaction): not needed until paywalled sites are re-added
- `/v2/agent` (Spark 1 autonomous): not needed because we have our own planner; reconsider if planner quality proves weak
- `zeroDataRetention` flag: not set for v1 (Italian trade press is public); revisit for enterprise tier

---

## 5. Research layer architecture

New package: `packages/research/`

### 5.1 File layout

```
packages/research/
├── package.json
├── src/
│   ├── index.ts
│   ├── planner.ts           # Haiku call, outputs ResearchPlan
│   ├── planner-prompt.ts    # System prompt for planner
│   ├── firecrawl-client.ts  # Wrapper around Firecrawl v2 endpoints
│   ├── fiber-client.ts      # Wrapper around Fiber AI endpoints (LinkedIn intelligence)
│   ├── fetcher.ts           # Executes the plan, returns FetchedEvidence[]
│   ├── cache.ts             # source_catalog_scrapes read/write
│   ├── dedupe.ts            # url_hash + content_hash dedup
│   ├── evidence-adapter.ts  # FetchedEvidence -> EvidenceRef
│   ├── catalog.ts           # source_catalog CRUD helpers
│   ├── telemetry.ts         # research_runs CRUD
│   ├── budget.ts            # per-deck scrape budget enforcement
│   └── types.ts             # ResearchPlan, FetchedEvidence, etc.
└── tsconfig.json
```

Registered as `@basquio/research` in `pnpm-workspace.yaml` and consumed by `@basquio/workflows`.

### 5.2 Planner (graph-first)

File: `packages/research/src/planner.ts`. Model: `claude-haiku-4-5` (cheap).

**Two-step planner.** Step 1 checks the existing workspace knowledge graph for relevant entities, facts, and scraped articles. Step 2 generates Firecrawl queries only for the gaps. Over time, as the graph accumulates coverage, fewer queries fire per run.

Input:

```ts
type PlannerInput = {
  briefSummary: string;                 // from synthesizeBrief output or chat turn
  briefKeywords: string[];              // extracted entities/terms from the brief
  stakeholders: Array<{name: string; role: string | null}>;
  scopeName: string | null;
  scopeKind: "client" | "category" | "function" | "system" | null;
  workspaceCatalog: SourceCatalogEntry[];  // all active sources
  budget: { maxUrls: number; maxUsd: number }; // caps
};

type ResearchPlan = {
  existingGraphRefs: EvidenceRef[];     // materialized from the knowledge graph (NEW)
  queries: ResearchQuery[];              // only gaps; may be empty if graph covers brief
  rationale: string;
  estimated_credits: number;
  graph_coverage_score: number;         // 0-1; 1 means graph fully covers brief, no scrape needed
};

type ResearchQuery = {
  id: string;                // "q1", "q2"
  text: string;              // "Kellanova Italia snack salati lancio 2026"
  intent: "category_landscape" | "competitor_launch" | "retailer_activity" |
          "consumer_trend" | "regulatory" | "brand_news" | "market_sizing";
  tier_mask: number[];       // e.g., [1, 2, 4]
  source_type_mask: string[]; // e.g., ["trade_press","association"]
  language: "it" | "en" | "both";
  freshness_window_days: number | null;
  max_results_per_source: number;  // default 3
  gap_reason: "no_coverage" | "stale_coverage" | "low_trust_coverage" | "new_angle";
};
```

**Step 1: graph coverage check (deterministic, no LLM).** For each brief keyword:

1. Query `entities` for matches by `canonical_name` or `aliases` (workspace-scoped). Pull related `entity_mentions` and `facts`.
2. Query `knowledge_chunks` via hybrid search (the existing `workspace_chat_retrieval` RPC from `apps/web/src/lib/workspace/agent-tools.ts:176-231`) with the brief keywords.
3. Filter to chunks from `knowledge_documents.kind = 'scraped_article'` to identify prior scraped coverage, separately track chunks from uploaded files.
4. Score coverage per keyword: `(count_of_matching_facts × avg_confidence) + (count_of_matching_chunks × 0.3)`. Higher = better coverage.
5. Also check freshness: for any `facts` with `valid_from` older than the brief's `freshness_window_days`, flag as stale regardless of count.
6. Materialize all matching entries as `EvidenceRef[]` with id prefix `graph:<fact_id>` or `graph:<chunk_id>` so they feed the current run's evidence set directly.

**Step 2: gap generation (Haiku LLM call).** Pass the keyword coverage scores, the brief, and the catalog to Haiku. Prompt:

> "You are planning research for a CPG insights analyst. The brief is: {briefSummary}. The workspace already has coverage for these keywords: {list with scores}. Fresh gaps are: {list}. Generate Firecrawl queries ONLY for the gaps. Return empty queries[] if graph coverage is sufficient."

Few-shot examples for 5 FMCG query types (category review, competitor scan, JBP prep, regulatory scan, ingredient innovation).

Zod-validated output. If `graph_coverage_score >= 0.8` and no stale flags, Haiku may return `queries: []` and the fetcher skips entirely.

Cost: ~$0.02 per call. Step 1 (graph check) adds ~500ms latency via RPC but saves on scrape cost downstream.

**Second-run optimization.** When Rossella runs her 10th Kellanova deck, the graph has accumulated Kellanova entities, facts, and prior scraped articles. Step 1 returns high coverage scores, Step 2 fires zero or few new queries, and the EvidenceRef set is populated mostly from `graph:` refs (with `firecrawl:` refs only for genuinely new angles or stale coverage refresh). This is the compounding moat made real.

### 5.3 Fetcher (dual-write: evidence + knowledge graph)

File: `packages/research/src/fetcher.ts`.

Algorithm per `ResearchQuery`:

1. Filter catalog sources by `tier_mask`, `source_type_mask`, `language`.
2. For each eligible source, fire `/v2/map` in parallel with the query's keywords as `search` parameter.
3. Collect `{url, title, description}` lists. Apply source-level `crawl_patterns.crawl_allow` and `crawl_deny` regex filters. Take top N by keyword match score (dense simhash or tf-idf against query text).
4. Dedupe URLs across sources by `url_hash`.
5. Check `source_catalog_scrapes` for fresh cache hits (`expires_at > now()`). For each cache hit, the corresponding `knowledge_documents` row already exists; resolve it via `source_catalog_scrapes.metadata.knowledge_document_id` and use its entities/facts for the EvidenceRef set. Subtract these URLs from the fetch list.
6. Fire `/v2/batch-scrape` on the remaining URLs. Poll until completion or timeout (default 180s per query).
7. For each scraped result (dual-write, both operations in one transaction when possible):
   - Compute `url_hash` and `content_hash`. If `content_hash` already exists in `source_catalog_scrapes` (same article republished under a different URL), skip both writes and reuse the existing `knowledge_document_id`.
   - **Write A — workspace knowledge.** Create a `knowledge_documents` row with `kind='scraped_article'`, `workspace_id`, `organization_id`, `source_type='firecrawl'`, metadata `{source_catalog_id, source_trust_score, scrape_run_id, language, published_at, source_url}`. Upload the markdown content to Supabase Storage under `workspace-scraped/{workspace_id}/{url_hash}.md`. Store the storage path on the row.
   - **Write B — scrape cache.** Insert into `source_catalog_scrapes` with all fields per §3.2, plus `metadata.knowledge_document_id` linking to the row from Write A.
   - **Enqueue extraction.** Use the existing `after()` pattern from `apps/web/src/app/api/workspace/uploads/confirm/route.ts:276-293` to enqueue `processWorkspaceDocument(documentId)`. This runs the shipped extraction pipeline (chunking → embeddings → `extractEntitiesFromDocument` → `persistExtraction`) populating `knowledge_chunks`, `entities`, `entity_mentions`, `facts`.
   - **Materialize EvidenceRef for the current run.** Call `evidence-adapter.ts` to convert the scrape into an `EvidenceRef` with id `firecrawl:<url_hash>`. Append to the run's evidence set.
8. If total scraped URLs < N desired, optionally fall back to `/v2/search` with catalog site filter; results follow the same dual-write path.
9. Return to the deck pipeline with the merged evidence set: `existingGraphRefs` (from §5.2 Step 1) + newly scraped `firecrawl:` refs.

Budget guard at each step: if cumulative `firecrawl_cost_usd` > `budget.maxUsd`, return early with partial results and log `budget_exceeded` in telemetry.

Per-run default budget: `maxUrls = 50`, `maxUsd = 2.00`. Both configurable per workspace admin (v2).

Error handling:
- A failed Firecrawl fetch on 1 of 20 URLs is logged, not fatal. Other 19 proceed.
- If Write A succeeds but Write B fails (cache miss on next run), the knowledge_document is still valid; the next scrape will simply not find a cache hit and re-fetch. Not ideal but safe.
- If Write A fails, skip Write B and skip extraction. The article is not in the graph and not cached. Partial-run completion per Rogo's Feb 2026 pattern.
- `processWorkspaceDocument` runs in `after()` so its failure does not block the current deck run; the EvidenceRef for the run is already written with raw markdown, so the deck still cites it. The article just won't surface in future chat retrieval until someone rescrapes or fixes the extraction.

**Important distinction between `expires_at` and durability.** The 24h TTL on `source_catalog_scrapes` is purely for scrape-cost dedup (don't re-hit Firecrawl on the same URL within 24h). The `knowledge_documents` row, its chunks, its extracted entities and facts are **permanent workspace assets** until explicitly deleted or a workspace admin action archives them. A URL scraped in Week 1 contributes to the graph forever, even though the `source_catalog_scrapes` row expires in 24h. Next-run queries can rebuild an EvidenceRef from the persistent graph tables instead of re-scraping.

### 5.4 Evidence adapter

File: `packages/research/src/evidence-adapter.ts`.

```ts
function toEvidenceRef(
  scrape: SourceCatalogScrapeRow,
  source: SourceCatalogRow,
): EvidenceRef {
  return {
    id: `firecrawl:${scrape.url_hash}`,
    sourceFileId: source.id,                    // catalog entry id
    fileName: scrape.url,
    fileRole: `tier${source.tier}-${source.source_type}`,
    sheet: source.host,
    metric: "scraped_article",
    summary: scrape.title ?? scrape.content_markdown.slice(0, 240),
    confidence: source.trust_score / 100,
    sourceLocation: scrape.url,
    rawValue: scrape.content_markdown,
    derivedTable: null,
    dimensions: {
      language: source.language,
      published_at: scrape.published_at?.toISOString() ?? "unknown",
      tier: String(source.tier),
      source_type: source.source_type,
      domain_tags: source.domain_tags.join(","),
      fetched_at: scrape.fetched_at.toISOString(),
    },
  };
}
```

These refs get merged into `analyticsResult.evidenceRefs` before `rankInsights()` runs. The existing validator at `insights.ts:115-152` will accept them because they are in the `validEvidenceIds` Set. Hallucinated URLs Claude might invent cannot enter the Set and will be dropped at line 125 (`return null`). This is why no validator change is needed.

### 5.5 Pipeline integration

File to edit: `packages/workflows/src/generate-deck.ts`.

Insert a new phase "research" between `normalize` and `understand`. Phase name added to `ClaudePhase` type at line 141.

```ts
type ClaudePhase = "normalize" | "research" | "understand" | "author" | "render" | "critique" | "revise" | "export";
```

Phase ordering in `DeckPhase` at line 565 gets the same update.

Implementation sketch:

```ts
// In the main phase loop, after normalize() completes
if (!isRerunWithCachedResearch(runId)) {
  const researchRun = await createResearchRun({
    workspaceId, deckRunId: runId, trigger: "deck_run",
    briefSummary: extractBriefSummary(normalizedInput),
  });

  try {
    const catalog = await listActiveCatalog(workspaceId);
    const plan = await createResearchPlan({
      briefSummary, stakeholders, scopeName, scopeKind,
      workspaceCatalog: catalog, budget: DEFAULT_RESEARCH_BUDGET,
    });
    await updateResearchRun(researchRun.id, { plan, status: "fetching" });

    const evidence = await executePlan(plan, { workspaceId, researchRunId: researchRun.id });
    await updateResearchRun(researchRun.id, {
      status: "completed",
      scrapes_succeeded: evidence.length,
      evidence_ref_count: evidence.length,
    });

    // Merge into the analyticsResult that feeds understand()
    analyticsResult.evidenceRefs = [...analyticsResult.evidenceRefs, ...evidence];
  } catch (err) {
    await updateResearchRun(researchRun.id, { status: "failed", error_detail: String(err) });
    // Non-fatal: deck proceeds with only uploaded-file evidence
  }
}
```

Rerun behavior: if `deck_runs.workspace_context_pack_hash` matches the hash from a prior successful run, skip the research phase and reuse the prior `research_runs.id` evidence refs (query `source_catalog_scrapes` where `source_id IN (...)` and `expires_at > now()`). This preserves the revise architecture described in `docs/motion2-workspace-architecture.md` §revise: no re-scraping cost on revise.

### 5.6 System prompt injection

File to edit: `packages/workflows/src/system-prompt.ts` (`buildBasquioSystemPrompt`).

**Coexistence note.** The system prompt was materially extended on 2026-04-22 by the NIQ promo / decimal commit (`22406d5`): 11 new bullets covering client-friendly-subordinate rule, no-invented-targets, SCQA-as-wrapper-only, claim-to-chart binding, redundancy rule, storyline contiguity, focal-brand persistence, promo story contract, deterministic decimal policy. Two new knowledge pack files were also added at the top of `KNOWLEDGE_PACK_FILES`: `docs/domain-knowledge/niq-promo-storytelling-playbook.md` and `docs/domain-knowledge/niq-decimal-policy.md`. **Do not remove or reorder any of those bullets or knowledge pack entries.** The research-layer XML block is additive, inserted alongside existing rules, not in place of them.

Add a new XML block to the author prompt (append after the existing `KNOWLEDGE_PACK_FILES` load and before the slide-level instructions):

```
<external_evidence>
The following external sources were scraped from the curated trade press catalog before this run, OR were retrieved from prior scrapes already in the workspace knowledge graph.
They are available as EvidenceRef entries with ids starting `firecrawl:` (new scrape this run) or `graph:` (prior scrape, already extracted into entities/facts/chunks).
When citing external context, use the id format `[firecrawl:<hash>]` or `[graph:<id>]` exactly as you would cite uploaded-file evidence.
You MAY NOT cite any URL that does not appear as a `firecrawl:<hash>` or `graph:<id>` in the evidence pool.
External scraped evidence does NOT override the NIQ promo storytelling contract, the claim-to-chart binding rule, the storyline contiguity rule, or the decimal policy. It supplements evidence for the same rules, never substitutes for uploaded NIQ data when the brief concerns proprietary numbers the client uploaded.
</external_evidence>
```

Claude 4.5/4.6 respects XML tags per Anthropic prompting guide. Reference: `docs/working-rules.md` "Claude 4.6 respects XML tags reduce misinterpretation."

### 5.7 LinkedIn intelligence: Fiber primary, not Firecrawl

**Architectural rule.** Any research plan that needs LinkedIn data routes through Fiber, not Firecrawl. `source_catalog` rows with `source_type = 'linkedin_fiber'` are resolved by the fetcher via `fiber-client.ts`, bypassing the `/v2/map` + `/v2/batch-scrape` Firecrawl path entirely.

**Rationale.** See §2.9 "Critical ToS posture." Firecrawl-stealth-scraping of LinkedIn is ToS-risky; Proxycurl, Apollo, and Seamless were all taken offline in 2025 by LinkedIn enforcement actions. Fiber operates as a LinkedIn-partnered API and is already integrated across three scripts in this repo. This is not a scope choice; it is a legal posture choice.

**`fiber-client.ts` contract.**

Extract the HTTP pattern from `scripts/contact-enrichment.ts:809-863` into `packages/research/src/fiber-client.ts`. Three endpoints for v1:

```ts
interface FiberClient {
  lookupByEmail(email: string): Promise<FiberProfile | null>;
  fetchProfilePosts(linkedinUrl: string): Promise<FiberPost[]>;
  peopleSearch(query: FiberPeopleSearchQuery): Promise<FiberProfile[]>;
}
```

- `/v1/email-to-person/single`: takes an email, returns a profile with role, company, headline, linkedin_url, entity_urn.
- `/v1/linkedin-live-fetch/profile-posts`: takes a linkedinUrl, returns recent posts as `FiberPost[]`.
- `/v1/people-search`: takes a structured query, returns a profile list. New v1 addition, not yet wired elsewhere in the repo; mirror the existing POST-JSON + retry + rate-limit discipline.

Env var: `FIBER_API_KEY`. If unset, the research package's config validator disables every `source_catalog` row with `source_type = 'linkedin_fiber'` and logs a clear error; the rest of the catalog continues to work.

**Stakeholder auto-enrichment path.** When the `createStakeholder` chat tool (§6.4) creates a new stakeholder with an `email` field, fire a background `fiber-client.lookupByEmail()` via the existing `after()` pattern from `apps/web/src/app/api/workspace/uploads/confirm/route.ts:276-293`. On success, populate `entities.metadata` with `role`, `company`, `headline`, `linkedin_url`, `entity_urn` from the Fiber response. This makes `createStakeholder` feel magical without changing the tool signature. Fiber charge info is persisted on `entities.metadata.fiber_charge_info` so cost telemetry can roll up per workspace.

**Explicit v1 non-goal: webhook-driven LinkedIn alerts.** Fiber has no job-move / company-change webhook. That surface is Coresignal territory ($1k-3k per month) and is out of scope until post-revenue. If a user asks for "notify me when Maria changes jobs," the correct v1 answer is "not yet." Do NOT add a polling-based substitute; it will appear cheap but quickly exceed the Coresignal price point on any meaningful follower count.

**Coexistence with Firecrawl.** Firecrawl remains the primary tool for trade press, association news, stats bodies, and the seed catalog's non-LinkedIn sources. The fetcher's per-query source routing determines client selection:

```ts
function selectClient(source: SourceCatalogEntry): "firecrawl" | "fiber" {
  if (source.source_type === "linkedin_fiber") return "fiber";
  return "firecrawl";
}
```

No LinkedIn URL ever reaches the Firecrawl `/v2/scrape` endpoint through this package.

---

## 6. Chat tool registry: existing + 8 new entries

This section covers Stream A (chat-as-ingest-and-edit). All new tools follow the AI SDK v6 `tool()` pattern from `agent-tools.ts`, registered in `getAllTools()` at line 370.

### 6.1 Tool: `saveFromPaste`

**Purpose:** User pastes an email / transcript / notes into chat and says "save this" or "this is from Maria at Kellanova." Extract entities, facts. Show extraction in an approval card. On approve, persist.

**Why approval card (not silent save):** Two reasons. First, the extractor can misread (wrong company, wrong date). Second, saving propagates into `stakeholders[]`, `facts`, `entities` and drives future deck briefs. Silent writes here are the trust-breaking moment identified in `docs/2026-04-20-workspace-v2-research.md`. Harvey / Rogo get away with silent saves because they save within an explicit Matter context with clear ownership; in Basquio the team workspace is shared so approval matters.

**Input schema (Zod):**

```ts
z.object({
  text: z.string().min(10).max(50_000),
  source_hint: z.enum(["email","transcript","meeting_note","chat_paste","document","other"]).default("chat_paste"),
  source_label: z.string().max(120).optional(),   // "Email from Maria 2026-04-22" etc.
  scope_id: z.string().uuid().optional(),         // override; default = current chat's scope
  dry_run: z.boolean().default(true)              // true = extract + render approval card; false = persist immediately (only if caller handled approval)
})
```

**Handler logic:**

1. If `dry_run`, run `extractEntitiesFromDocument(text, source_label ?? source_hint)` from `apps/web/src/lib/workspace/extraction.ts:119-160`. Return `{preview: {entities, facts}, extraction_id}` without writing to DB. Extraction result is cached in-memory for 5 minutes keyed by `extraction_id`.
2. If `dry_run: false`, look up the cached extraction by `extraction_id` in the input, call a new helper `persistExtractionFromText(text, extraction, scopeId, workspaceId, sourceLabel)` that:
   - Creates a synthetic `knowledge_documents` row (kind='chat_paste', blob stored in content field, bucket='workspace-chat-pastes', path = `chat_paste/{conversation_id}/{timestamp}`)
   - Calls `persistExtraction(documentId, extraction)` reusing the existing function from `apps/web/src/lib/workspace/process.ts:~290`
   - Writes a `conversation_attachments` link so the pasted content appears in the conversation's file list

**Tool result rendering:** New UI component `ExtractionApprovalCard` in `ToolChips.tsx`:

```
┌────────────────────────────────────────────────────────────┐
│ [icon] Paste saved                                         │
│                                                            │
│ Extracted from email from Maria at Kellanova              │
│                                                            │
│ People (2)                                                 │
│   • Maria Rossi, Head of Insights at Kellanova Italia      │
│   • Giuseppe Verdi, Category Manager                       │
│                                                            │
│ Brands (1)      Categories (1)    Facts (3)               │
│   Kellanova     Snack Salati      [expand]                │
│                                                            │
│ Scope: client:Kellanova                                    │
│                                                            │
│ [Save all] [Review each] [Discard]                         │
└────────────────────────────────────────────────────────────┘
```

`[Save all]` triggers a follow-up chat turn (AI SDK v6 `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` pattern) that calls `saveFromPaste` again with `dry_run: false` and the `extraction_id`. `[Review each]` opens an inline editable list (out of scope for v1; ship as `Save all` or `Discard` only). `[Discard]` drops the cached extraction.

**AI SDK v6 approval pattern:** Per [Vercel AI SDK 6 docs](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), implement with the standard `tool()` definition and client-side approval UX. Card is a regular tool-result render; the button wires to a client action that sends a new message `Approve extraction {extraction_id}` which the system prompt tells the model to handle by calling `saveFromPaste({dry_run: false, extraction_id})`.

### 6.2 Tool: `scrapeUrl`

**Purpose:** User drops a URL in chat and asks "pull this in." Chat calls Firecrawl on that URL, saves as a document, extracts entities. Approval card like `saveFromPaste`.

**Input schema:**

```ts
z.object({
  url: z.string().url(),
  scope_id: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
  dry_run: z.boolean().default(true)
})
```

**Handler logic:**

1. Check URL host against `source_catalog` for this workspace. If present → use cached scrape if fresh, else fetch with `/v2/scrape`. If absent → treat as an ad-hoc URL; still fetch via `/v2/scrape` but store in `knowledge_documents` with `kind='chat_url'` and an explicit note in metadata: "scraped from non-catalog URL."
2. Dry-run: extract entities/facts from markdown, return approval card exactly like `saveFromPaste`.
3. Persist on approval.

**Cost guard:** rate-limit per user (max 20 URL fetches per hour per user). Prevents accidental cost runaway.

### 6.3 Tool: `editStakeholder`

**Purpose:** "Update Maria at Kellanova to prefer 52-week reads excluding private label." Chat updates `entities.metadata.preferences.structured`.

**Input schema:**

```ts
z.object({
  person_id: z.string().uuid().optional(),
  name: z.string().min(1).max(120).optional(),   // if no person_id, look up by name
  company: z.string().max(120).optional(),
  patch: z.object({
    role: z.string().max(120).optional(),
    company: z.string().max(120).optional(),
    description: z.string().max(1000).optional(),
    linked_scope_id: z.string().uuid().optional(),
    preferences: z.object({
      free_text: z.string().max(2000).optional(),
      structured: z.object({
        chart_preference: z.string().max(200).optional(),
        deck_length: z.string().max(200).optional(),
        language: z.string().max(50).optional(),
        tone: z.string().max(200).optional(),
        review_day: z.string().max(50).optional(),
      }).partial().optional()
    }).partial().optional(),
    notes: z.string().max(4000).optional(),
    aliases_to_add: z.array(z.string().max(120)).max(10).optional()
  })
}).refine(d => d.person_id || d.name, "Must provide person_id or name")
```

**Handler logic:**

1. Resolve person: by id or by `canonical_name ilike name` scoped to workspace (use existing `getWorkspacePerson` and the entity lookup pattern from `showStakeholderCardTool`).
2. If no match, return `{status: "not_found", suggestions: [top 3 similar names]}`. Chat prompts user to clarify or create new.
3. If match, compute patch merged into `metadata`. Render `StakeholderEditApprovalCard` showing before/after diff.
4. On approval (follow-up chat turn with `confirm=true`), call `updateWorkspacePerson(personId, patch)` from `apps/web/src/lib/workspace/people.ts`.

**Rendering:** `StakeholderEditApprovalCard` shows the same layout as `StakeholderCard` but with strikethrough-old + bold-new diff style. `[Update] [Cancel]` buttons.

### 6.4 Tool: `createStakeholder`

**Purpose:** "Create a stakeholder profile for Giulia Bianchi, Head of Marketing at Amadori." Needed when `editStakeholder` returns `not_found`.

**Input schema:**

```ts
z.object({
  canonicalName: z.string().min(1).max(120),
  role: z.string().max(120).optional(),
  company: z.string().max(120).optional(),
  description: z.string().max(1000).optional(),
  linked_scope_id: z.string().uuid().optional(),
  preferences: z.object({
    free_text: z.string().max(2000).optional(),
    structured: z.object({/* same as editStakeholder */}).partial().optional()
  }).partial().optional(),
  aliases: z.array(z.string().max(120)).max(10).optional(),
  notes: z.string().max(4000).optional(),
  dry_run: z.boolean().default(true)
})
```

**Handler logic:** Calls `createWorkspacePerson()` from `people.ts` on approval. Dry-run returns preview; `dry_run: false` persists.

### 6.5 Tool: `editRule`

**Purpose:** "Remember: Kellanova decks always use 52-week rolling excluding private label unless specified." Or "Archive that rule about source callouts bottom-left, it's outdated."

This is a superset of `teachRule`. Keep `teachRule` for the simple explicit-save case. `editRule` handles:

- **Create** (if `rule_id` absent, behaves like `teachRule` with explicit output)
- **Update** (patch content, memory_type, scope)
- **Archive** (set `metadata.archived_at`)
- **Pin / unpin** (set `metadata.pinned_at`)

**Input schema:**

```ts
z.object({
  action: z.enum(["create","update","archive","unarchive","pin","unpin","delete"]),
  rule_id: z.string().uuid().optional(),
  scope: z.string().optional(),
  memory_type: z.enum(["procedural","semantic","episodic"]).optional(),
  content: z.string().min(3).max(4000).optional(),
  reason: z.string().max(400).optional()  // for telemetry + audit
}).refine(d => d.action === "create" || d.rule_id, "Non-create actions require rule_id")
```

**Handler logic:** Maps to existing `memory.ts` functions: `createMemoryEntry`, `updateMemoryEntry`, `archiveMemoryEntry`, `togglePinMemoryEntry`, `deleteMemoryEntry`.

**Rendering:** `RuleEditApprovalCard` component showing action + old/new content + scope + reason.

For `action: "delete"` and `"archive"`, always require approval. For `"create"`, `"update"`, `"pin"`, and `"unpin"`, approval is required by default but the system prompt can decide to fire directly on clear user intent ("remember that X") and render a `TeachRuleCard` confirmation instead.

### 6.6 Tool: `draftBrief`

**Purpose:** "Draft me a brief for a Kellanova snack salati Q1 2026 category review." Produces a structured brief object, pre-filled from workspace context, ready for the deck generation drawer.

This is the chat-side counterpart to the automatic `synthesizeBrief` that runs when the user clicks "Generate deck." `draftBrief` lets the user shape the brief conversationally before launching the deck.

**Input schema:**

```ts
z.object({
  topic: z.string().min(3).max(500),           // "Kellanova Snack Salati Q1 2026 category review"
  audience_hint: z.string().max(200).optional(), // "head of insights + marketing director"
  scope_id: z.string().uuid().optional(),
  extra_instructions: z.string().max(1000).optional(),
  include_research: z.boolean().default(true)   // if true, runs a dry research plan (catalog query, no fetch) and includes suggested sources in the brief
})
```

**Handler logic:**

1. Build a `WorkspaceContextPack` via `buildWorkspaceContextPack()` using the given `scope_id` or the chat's current scope.
2. Call `synthesizeBrief({pack, turns: currentChatTurns, explicitTopic: topic, audienceHint})` with a revised prompt (see §6.10) that now uses `stakeholder.preferences.structured` fully.
3. If `include_research: true`, call `createResearchPlan()` from `packages/research` in **dry-run mode** (planner only, no fetcher). Attach the ResearchPlan to the brief preview.
4. Return `{brief, pack_snapshot, research_plan_preview}`.

**Rendering:** `BriefDraftCard` component:

```
┌──────────────────────────────────────────────────────┐
│ Brief draft — Kellanova Snack Salati Q1 2026         │
│                                                      │
│ Audience: Head of Insights + Marketing Director       │
│ Length: 20-30 slides (Maria prefers concise)          │
│ Tone: consultative, Italian (Maria default)           │
│ Thesis: [editable textarea]                           │
│ Stakes: [editable textarea]                           │
│                                                      │
│ Context Basquio will use:                             │
│   • 3 stakeholder preferences loaded                  │
│   • 4 workspace rules apply                           │
│   • 5 files in scope attached as evidence             │
│   • Research plan: 6 queries, 18 estimated sources    │
│                                                      │
│ [Open in generate drawer] [Refine in chat]            │
└──────────────────────────────────────────────────────┘
```

`[Open in generate drawer]` launches the existing `workspace-generation-drawer.tsx` pre-filled with this brief. `[Refine in chat]` keeps the user in conversation to tweak.

### 6.7 Tool: `explainBasquio`

**Purpose:** Giulia asks "what can you do?" or "how do I save a rule?" and chat actually knows itself. No more "I'm an AI assistant, I can help with…"

**Input schema:**

```ts
z.object({
  topic: z.enum([
    "overview", "memory", "stakeholders", "rules",
    "decks", "briefs", "sources", "scopes",
    "what_you_know_about_me", "what_i_can_edit"
  ])
})
```

**Handler logic:** Returns a short structured response per topic, hydrated with live workspace state:

- `memory`: "You have 23 memory entries across 4 scopes. I can save new rules, edit existing ones, or pin the ones you want sticky. Just say 'remember X' or 'update that Kellanova rule to say Y'."
- `stakeholders`: "Your workspace has 12 stakeholder profiles. I can show any of them, update preferences, or create new ones. Say 'show me Maria at Kellanova' or 'update her to prefer 52-week reads'."
- `what_you_know_about_me`: queries the workspace for memory entries, stakeholders, scopes relevant to the current user. Returns a 1-paragraph summary.

This is the self-knowledge that fixes the "chat looks like a chat wrapper" objection Rossella raised Apr 22.

### 6.8 Updated system prompt

File: `apps/web/src/lib/workspace/agent.ts`.

Replace current `SYSTEM_PROMPT` with:

```
You are Basquio, a senior FMCG/CPG insights analyst working alongside the user. You live in their workspace, not in a chat tab. You know what this workspace contains and what the user can do in it.

WHAT BASQUIO IS
A workspace-native assistant for CPG/FMCG insights work. It remembers stakeholders, editorial rules, KPI conventions, and past deliverables. It researches external trade press to ground new work. It produces consulting-grade decks on demand. The user never has to re-explain context across sessions.

WHEN THE USER PASTES CONTENT
If the user pastes an email, transcript, meeting note, or document body into chat, they almost certainly want Basquio to save it into the workspace. Call saveFromPaste with the pasted text. The tool shows an approval card so the user sees what was extracted before anything persists. Never silently ingest.

If the user drops a URL, call scrapeUrl. Same approval-card pattern.

WHEN THE USER MAKES A STATEMENT OF PREFERENCE, RULE, OR FACT
Examples: "Always use 52-week rolling for Kellanova," "Giulia prefers source callouts bottom-left," "Remember that Amadori's fiscal year ends in September."

Call editRule with action=create for new rules. Call editRule with action=update when the user is revising an existing one. Never auto-infer rules from conversational context; only save when the user is explicit.

WHEN THE USER ASKS ABOUT A STAKEHOLDER
"Who is Maria?" "What does she prefer?" "Update her to prefer quarterly reviews on Thursdays." Use showStakeholderCard for read, editStakeholder for update, createStakeholder for new.

WHEN THE USER ASKS TO PREPARE A BRIEF OR DECK
Use draftBrief to pre-fill a structured brief drawing on stakeholder preferences, workspace rules, and the scope context. Offer the user the choice to open the brief in the generate drawer, or refine it further in chat.

WHEN ANSWERING SUBSTANTIVE QUESTIONS
Follow the existing evidence-first rule. Prefer analyzeAttachedFile for questions about files the user just uploaded in this conversation (most precise for structured data). Use retrieveContext for cross-workspace questions. Cite every grounded claim inline.

WHEN THE USER ASKS "WHAT CAN YOU DO" OR "HOW DOES THIS WORKSPACE WORK"
Call explainBasquio with the relevant topic. Do not generate generic AI-assistant copy. Return what this specific workspace actually contains and what actions the user can take.

ANTI-PATTERNS
Never say "I'm just an AI" or refuse a workspace action that a tool supports. Never invent URLs, numbers, stakeholder details, or preferences. If you don't have a citation, mark the claim as "(not in workspace)" so the user can act.
```

### 6.9 Tool registry update

File: `apps/web/src/lib/workspace/agent-tools.ts`, `getAllTools()` function at line 370.

```ts
export function getAllTools(ctx: AgentCallContext) {
  return {
    memory: readMemoryTool(ctx),
    teachRule: teachRuleTool(ctx),
    editRule: editRuleTool(ctx),
    retrieveContext: retrieveContextTool(ctx),
    analyzeAttachedFile: analyzeAttachedFileTool(ctx),
    listConversationFiles: listConversationFilesTool(ctx),
    showMetricCard: showMetricCardTool(ctx),
    showStakeholderCard: showStakeholderCardTool(ctx),
    editStakeholder: editStakeholderTool(ctx),
    createStakeholder: createStakeholderTool(ctx),
    saveFromPaste: saveFromPasteTool(ctx),
    scrapeUrl: scrapeUrlTool(ctx),
    draftBrief: draftBriefTool(ctx),
    explainBasquio: explainBasquioTool(ctx),
    suggestServices: suggestServicesTool(ctx),
  } as const;
}
```

Registry count: 15 entries (14 tool families). Breakdown: 7 existing (memory, teachRule, retrieveContext, analyzeAttachedFile, listConversationFiles, showMetricCard, showStakeholderCard) plus 8 new entries (editRule, editStakeholder, createStakeholder, saveFromPaste, scrapeUrl, draftBrief, explainBasquio, suggestServices). Family count is 14 because `editRule` is the superset over the existing `teachRule`, which stays in the registry for backward compatibility; the two are counted as one family.

### 6.10 Brief synthesis upgrade

File to edit: `apps/web/src/lib/workspace/synthesize-brief.ts:54-102`.

Replace `buildUserPrompt` to include the full stakeholder `preferences.structured` payload. Example section to add:

```
Stakeholder preferences (apply to tone, length, language, chart conventions unless overridden):
${pack.stakeholders.map(s => `
  ${s.name} (${s.role ?? "role unknown"})
    chart: ${s.preferences?.structured?.chart_preference ?? "default"}
    deck length: ${s.preferences?.structured?.deck_length ?? "default"}
    language: ${s.preferences?.structured?.language ?? "default"}
    tone: ${s.preferences?.structured?.tone ?? "default"}
    free text: ${s.preferences?.free_text ?? ""}
`).join("")}
```

Also inject the `renderedBriefPrelude` from the pack as an additional context section if the prelude is non-empty. Currently the prelude is built but not consumed by the synthesizer.

### 6.11 Tool: `suggestServices`

**Purpose:** Analyst asks "what should I propose to Maria next quarter?" or "what NIQ services could I sell into this scope?" and chat returns 3-5 concrete service recommendations anchored to the scope's actual data and stakeholder context. Mirrors Rossella's stated workflow in Discord 2026-04-21: "Basquio bot vorrei usarlo per capire come vendere servizi ai clienti. Gli darei in knowledge i servizi NIQ, poi sulla base dei dati excel gli chiederei qual è il gap che il servizio x mi aiuterebbe a colmare."

Two audiences with different framing:

- **niq_analyst_selling** (default). Framing: which NIQ services to pitch into this client.
- **brand_side_commissioning**. Framing: which research services to commission for this brand.

**Input schema:**

```ts
z.object({
  scope_id: z.string().uuid().optional(),
  data_summary_hint: z.string().max(500).optional(),
  audience: z.enum(["niq_analyst_selling","brand_side_commissioning"]).default("niq_analyst_selling")
})
```

**Handler logic:**

1. Build a `WorkspaceContextPack` via `buildWorkspaceContextPack()` using the given `scope_id` or the chat's current scope.
2. Load the NIQ services catalog from `docs/domain-knowledge/niq-services-catalog.md` (see §6.12 for the file contract). Parse the markdown table into typed rows.
3. Call Haiku with a prompt that combines: scope context, stakeholder preferences, uploaded data summary if any, and the NIQ services catalog. Prompt enforces Zod-valid output of 3-5 service recommendations.
4. Return `{recommendations: ServiceRecommendation[], catalog_review_pending: boolean}` where `catalog_review_pending` is `true` until Rossella/Fra sign off on the catalog (see §6.12).

Zod-typed recommendation shape:

```ts
type ServiceRecommendation = {
  service_name: string;          // from catalog
  rationale: string;              // 1-2 sentences, anchored to data in the scope
  evidence_hooks: string[];       // which facts/entities/files support this
  typical_deliverable: string;    // from catalog
  priority: "high" | "medium" | "low";
};
```

**Rendering:** New `ServiceSuggestionCard` component in `ToolChips.tsx`. Each recommendation renders as one row with:

- Service name (bold)
- Rationale (1-2 sentence summary)
- Evidence chips (clickable, drill into the source)
- `[Draft brief for this service]` button. Launches `draftBrief` pre-populated with the service as the topic and the scope as scope_id.
- Priority pill on the right.

Footer when `catalog_review_pending === true`: "Catalog pending NIQ-side review." Text only, no icon.

**Empty / edge cases:**

- Scope has zero stakeholders and zero files: Haiku cannot anchor; tool returns `{recommendations: [], message: "Not enough scope context to recommend services. Drop a file or add a stakeholder first."}`.
- Catalog file missing: tool returns an actionable error pointing to §6.12.
- User selects a recommendation and clicks `[Draft brief]`: `draftBrief` fires with `topic = recommendation.service_name` and `extra_instructions` prefilled with the rationale and evidence hooks.

**Cost guard:** Haiku call per tool invocation, roughly $0.02. No additional external-tool calls. No rate limit required at v1; add one if abuse materializes.

### 6.12 New knowledge pack: NIQ services catalog

**File:** `docs/domain-knowledge/niq-services-catalog.md`. Read-only markdown table with columns:

- `service_name`
- `description`
- `typical_data_inputs`
- `typical_analyst_question`
- `typical_deliverable`

**v1 stub contents.** Seed from the public NIQ product list: Retail Measurement Services, Consumer Panel Services, Custom Intelligence, Brand Track, Innovation New Product, Shopper Trends, Concept Test, Price Architecture, Promotional Effectiveness, Distribution Health Check. 10 rows minimum, 30 rows maximum.

**Review process.** Ship with a top-of-file "Catalog pending NIQ-side review (2026-04-23). Rossella/Fra window: 7 days. Until signed off, `suggestServices` renders a footer indicating this." Remove the top-of-file notice and flip the `suggestServices` tool's `catalog_review_pending` flag only after Rossella/Fra confirm the catalog matches their internal service list.

**Loading.** At build or first-request, parse the markdown table via a small table-to-JSON utility colocated in `packages/research/src/niq-services-catalog.ts`. Cache in memory per worker; re-parse on file change in dev.

---

## 7. UI surfaces

### 7.1 Chat approval cards

New components in `apps/web/src/components/workspace-chat/ToolChips.tsx`:

1. `ExtractionApprovalCard` — for `saveFromPaste` and `scrapeUrl` dry-run output
2. `StakeholderEditApprovalCard` — for `editStakeholder` dry-run
3. `StakeholderCreateApprovalCard` — for `createStakeholder` dry-run
4. `RuleEditApprovalCard` — for `editRule` dry-run (especially destructive actions)
5. `BriefDraftCard` — for `draftBrief` output
6. `ExplainBasquioCard` — for `explainBasquio` output (rich structured info about workspace state)

Each follows the design-token language from `docs/design-tokens.md`. Never use emoji per `docs/working-rules.md` "feedback_no_emojis.md." Use Phosphor icons via `@phosphor-icons/react` as existing chips do.

### 7.2 Source catalog browser (v1: read-only)

Route: `/workspace/sources` (new page at `apps/web/src/app/(workspace)/workspace/sources/page.tsx`).

API: `GET /api/workspace/sources` returns the catalog for the current workspace.

Layout:

- Header: "Sources we research from when you ask for a deck"
- Filter chips: Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 | All
- Filter chips: Italian | English | All
- Grid of source cards showing: host, tier, type, language, trust score, domain tags, last scraped, status
- Click a card → drawer with full catalog entry + recent scrapes list + manual "rescrape" button (disabled in v1; ship as visual affordance only)

No edit UI in v1. Catalog is seeded via migration and admin-edited via SQL for now. Admin UI is v2.

### 7.3 Research run telemetry

On every deck generation status page (`apps/web/src/components/workspace-generation-status.tsx`), add a collapsible "Research" row that polls `research_runs` linked to the current deck_run and shows:

- Status: planning | fetching | indexing | completed | failed
- Planned queries (from `plan.queries[].text`)
- Sources hit / sources scraped / sources cached
- Firecrawl cost so far
- `[View sources]` button expanding a list of scraped URLs with title + source + published date

This makes Rossella's "it must really be accurately scraped and not fabricated" concern visible in the UI. She can click a URL and verify it exists.

### 7.4 Sidebar transparency panel (per the SOTA research)

Add a "Workspace memory" mini-panel to the workspace home page and scope pages showing:

- Count of stakeholders, rules, facts, entities
- Last 5 memory entries created (link each to detail)
- Last 5 research runs (link each to the deck + sources)
- "What Basquio knows about me" button → triggers `explainBasquio(topic: "what_you_know_about_me")` as a chat action

Pattern lifted from Anthropic Memory Tool UI (March 2026 GA) and Claude Projects' memory browser.

---

## 8. Acceptance criteria

### 8.1 Chat ingest flow

- [ ] User pastes an email into chat. `saveFromPaste` fires automatically (model decides). An `ExtractionApprovalCard` renders inline showing extracted people, brands, categories, facts.
- [ ] Clicking `[Save all]` on the card persists entities / facts / mentions to the DB and attaches a `knowledge_documents` row of kind `chat_paste`. The conversation's file list now shows the paste.
- [ ] Clicking `[Discard]` removes the cached extraction; no DB writes.
- [ ] Pasting the same content twice detects dup via `content_hash` and returns "already saved" without a second write.
- [ ] User pastes a URL. `scrapeUrl` fires. Firecrawl pulls markdown. Same approval card. On approve, stored in `knowledge_documents` kind `chat_url`.
- [ ] Host of a URL matches a catalog entry → scrape uses cached content if fresh.
- [ ] Rate limit: 20 `scrapeUrl` calls per hour per user. 21st call returns a rate-limit card.

### 8.2 Chat edit flow

- [ ] "Update Maria at Kellanova to prefer 52-week reads excluding private label" produces a `StakeholderEditApprovalCard` with before/after diff.
- [ ] Approving the edit updates `entities.metadata.preferences.structured`.
- [ ] "Archive the rule about source callouts bottom-left" produces a `RuleEditApprovalCard`. Approval sets `memory_entries.metadata.archived_at`.
- [ ] "Remember that Amadori's fiscal year ends in September" creates a new memory entry via `editRule(action: "create")`. Shown as a `TeachRuleCard` on success (same as current `teachRule`).
- [ ] "What can you do?" routes to `explainBasquio(topic: "overview")` and returns workspace-specific capability info, not generic AI boilerplate.

### 8.3 Brief synthesis

- [ ] "Draft me a brief for Kellanova snack salati Q1 2026 category review" fires `draftBrief`. `BriefDraftCard` renders with:
  - Audience prefilled from stakeholder preferences if the scope has named stakeholders
  - Tone and language from preferences.structured
  - Deck length default from preferences
  - A research-plan preview showing the planner's intended queries (no fetch yet)
- [ ] Clicking `[Open in generate drawer]` launches the existing drawer pre-populated.
- [ ] The existing automatic `synthesizeBrief` (triggered when user clicks "Generate deck" without going through `draftBrief`) now incorporates `preferences.structured` in its prompt.

### 8.4 Research layer

- [ ] Running a deck from a workspace conversation triggers a `research_run` with `trigger='deck_run'`. Status transitions: pending → planning → fetching → indexing → completed.
- [ ] Planner Step 1 runs a deterministic graph coverage check and returns `existingGraphRefs` populated from prior scraped articles + uploaded files.
- [ ] Planner Step 2 generates `queries[]` ONLY for gaps (no coverage, stale coverage, low trust, or new angle).
- [ ] Planner returns `graph_coverage_score` between 0 and 1; value ≥ 0.8 with no stale flags means `queries[]` may be empty.
- [ ] Fetcher calls `/v2/map` per eligible source, `/v2/batch-scrape` on filtered URLs, dedupes by `url_hash` AND `content_hash` (catches republished articles).
- [ ] Cache hit: a URL already in `source_catalog_scrapes` with `expires_at > now()` is not re-scraped; the evidence ref is rebuilt from the linked `knowledge_documents` row.
- [ ] `analyticsResult.evidenceRefs` receives the merged set: `graph:<id>` refs from the graph coverage step + `firecrawl:<hash>` refs from new scrapes.
- [ ] The author call produces a deck with citations in the form `[firecrawl:<hash>]` for new scraped claims and `[graph:<id>]` for graph-sourced claims. Uploaded-file claims use the existing citation form.
- [ ] Revise does not re-scrape: `research_run` for the rerun reuses the prior run's scrapes where hash is still fresh.
- [ ] A research_run that exceeds budget halts with `status='completed'` and `metadata.budget_exceeded=true`. Deck still ships with partial evidence.
- [ ] A scrape failure on 1 of 20 URLs is logged but not fatal; deck still ships with 19.
- [ ] `insights.ts:115-152` validator drops any insight whose `evidenceIds` cite a URL that is NOT in the evidence set. No hallucinated URLs can appear in the final deck.

### 8.5 Workspace knowledge persistence (dual-write verification)

- [ ] After a research run completes, every scraped article has a corresponding `knowledge_documents` row with `kind='scraped_article'`.
- [ ] The scraped markdown is in Supabase Storage at `workspace-scraped/{workspace_id}/{url_hash}.md`.
- [ ] `processWorkspaceDocument()` fires asynchronously in `after()` and within 60 seconds populates `knowledge_chunks`, `entities`, `entity_mentions`, `facts` for the scraped article.
- [ ] A subsequent chat turn asking about an entity mentioned only in the scraped article surfaces via `retrieveContext` with the scraped-article citation (not just the deck it was used in).
- [ ] A second deck run 24 hours later on the same brief hits the graph-first planner: `existingGraphRefs` is populated with the prior scraped content, `queries[]` is empty or minimal, Firecrawl cost for the second run is near zero.
- [ ] A second deck run 48 hours later (past the 24h `expires_at`) still reuses the knowledge graph content via `existingGraphRefs`; the `source_catalog_scrapes` cache expiry does NOT trigger re-scraping if the graph already has the content.
- [ ] Deleting a `source_catalog` source does NOT delete historical `knowledge_documents` rows derived from it (per `ON DELETE SET NULL` on the source_catalog_id column in knowledge_documents). Historical knowledge is preserved; the source is just no longer used for future scrapes.
- [ ] An entity extracted from a scraped article has lower default `confidence` on derived facts than entities from uploaded files (trust_score-derived), so the deck's author prompt can weight them appropriately.

### 8.6 UI surfaces

- [ ] `/workspace/sources` lists 18 active catalog entries (the v1 seed) with the expected fields.
- [ ] Deck generation status page shows a collapsible Research row with live telemetry.
- [ ] Approval cards render correctly in streaming mode (partial input → output states).
- [ ] No em dashes appear in any new UI copy. No emojis.

### 8.7 Cost and performance

- [ ] Per-deck Firecrawl cost stays under `$2.00` by default (configurable).
- [ ] Planner latency under 10 seconds for typical briefs.
- [ ] Fetcher (map + batch-scrape) completes within 3 minutes for up to 50 URLs across 10 sources.
- [ ] Cached revise adds <5 seconds to pipeline wall-clock.
- [ ] No `pause_turn` continuations added. Deck pipeline stays single-call per `rules/canonical-rules.md:65-72`.

---

## 9. Build sequence

Sequential where dependencies exist, parallel where not. Estimates assume one implementation agent working from this spec.

### Week 1

**Day 1 — migrations and seed**
- Ship 3 migrations: `source_catalog`, `source_catalog_scrapes`, `research_runs`
- Ship seed migration with 18 verified-active + 7 pending-verification (paused) + 6 permanently-paused Italian/UK sources
- Verify: catalog visible via `SELECT * FROM source_catalog` for team workspace

**Day 2 — research package skeleton**
- Create `packages/research/` with `package.json`, `tsconfig.json`, wire into workspace
- Port Firecrawl client from `scripts/contact-enrichment.ts:868-919` to `packages/research/src/firecrawl-client.ts` with all 6 endpoints typed
- Unit tests: stub Firecrawl API, verify request shapes

**Day 3 — planner with graph-first**
- Implement `planner.ts` with the two-step flow per §5.2
- Step 1: deterministic graph coverage check (reuse `workspace_chat_retrieval` RPC, filter to `kind='scraped_article'` + uploaded files; score per keyword; flag stale by `freshness_window_days`)
- Step 2: Haiku call for gap queries with Zod-enforced output; few-shot examples for 5 FMCG query types
- **Extraction quality sanity check (per R7):** hand-label 20 sample Italian trade-press scrapes, measure extractor precision and recall. If recall < 75%, upgrade prompt with Italian-FMCG few-shot examples before enabling graph-first in production.
- Manual test: pass 5 example briefs on an empty graph, verify full queries generated; re-run same briefs after one scrape round, verify graph-coverage-score rises and queries shrink.

**Day 4 — fetcher + dual-write + evidence adapter**
- Implement `fetcher.ts`, `cache.ts`, `dedupe.ts`, `evidence-adapter.ts`, `budget.ts` per §5.3
- **Dual-write integration:** for each scrape, create `knowledge_documents` row (kind='scraped_article'), upload markdown to Storage, insert `source_catalog_scrapes` with `metadata.knowledge_document_id`, enqueue `processWorkspaceDocument()` via `after()` for async extraction
- Cache-hit path: resolve existing `knowledge_document_id` from prior scrape, rebuild EvidenceRef from linked document, skip Firecrawl fetch
- Manual test: run a full fetch against 3 sources, verify entries in both `source_catalog_scrapes` AND `knowledge_documents`, verify extraction produces `entities` + `facts` rows within 60 seconds, verify `retrieveContext` surfaces the scraped content on a follow-up chat turn

**Day 5 — deck pipeline integration**
- Add `research` phase to `generate-deck.ts`
- Update `ClaudePhase` type and phase ordering
- Wire `research_runs` telemetry
- Update `system-prompt.ts` with `<external_evidence>` block
- End-to-end smoke test: run a full deck with research enabled

### Week 2

**Day 6 — chat tools part 1**
- Ship `saveFromPaste` with `ExtractionApprovalCard`
- Ship `scrapeUrl` with same card component
- Wire 5-min in-memory extraction cache
- Update system prompt per §6.8

**Day 7 — chat tools part 2**
- Ship `editStakeholder`, `createStakeholder`, `StakeholderEditApprovalCard`, `StakeholderCreateApprovalCard`
- Ship `editRule`, `RuleEditApprovalCard`
- Keep `teachRule` for backward compat

**Day 8: brief tool + explain + suggest services**
- Ship `draftBrief`, `BriefDraftCard` with research-plan preview
- Ship `explainBasquio`, `ExplainBasquioCard`
- Ship `suggestServices`, `ServiceSuggestionCard`, and the `packages/research/src/niq-services-catalog.ts` parser that loads `docs/domain-knowledge/niq-services-catalog.md`. Wire the `[Draft brief for this service]` button to `draftBrief`.
- Upgrade `synthesizeBrief` to use `preferences.structured` fully

**Day 9 — UI surfaces**
- Ship `/workspace/sources` read-only catalog browser
- Add Research telemetry row to deck-run status
- Add workspace-memory mini-panel to scope pages

**Day 10 — QA pass**
- Manual test all acceptance criteria in §8
- Fix bugs surfaced
- Ship behind a workspace-level feature flag `research_layer_enabled` for safe rollout

### Week 3 (stretch)

**Days 11-12 — production hardening**
- Cost monitoring dashboard
- Alert when a single research_run exceeds $3 or when cumulative weekly cost per workspace exceeds $50
- Retry logic for Firecrawl timeouts

**Days 13-15 — catalog onboarding via `/v2/crawl`**
- Admin-only CLI: `pnpm catalog:onboard --host mark-up.it` runs a full `/v2/crawl` with `includePaths` for historical articles
- Populates `source_catalog_scrapes` with 100-500 historical docs per source
- Improves cache hit rate dramatically for common queries

---

## 10. Risks and open questions

**R1: Planner on Haiku is too weak.** Mitigation: upgrade to Sonnet (cost $0.02 → $0.08 per plan). Unlikely to break budget. Still cheap relative to the $3-5 deck cost.

**R2: Italian trade press proves JS-rendered at deeper pages than the homepage test showed.** Mitigation: flip the source's `crawl_patterns.requires_enhanced_proxy = true`, take the +4-5 credits/URL hit. The fetcher already reads this flag.

**R3: Rossella wants sources not in the catalog.** Mitigation: v1 has no add-UI. She can ask in Slack / pushes a migration PR. v2 ships admin-edit UI.

**R4: Content dedup misses near-duplicates (republished with minor edits).** Mitigation: v1 uses exact `content_hash`. If we see dup clutter in real use, upgrade to simhash or embedding-similarity dedup in v2.

**R5: Approval-card UX feels heavy if users do 20 pastes an hour.** Mitigation: add a per-user preference "auto-approve extractions from trusted sources" (e.g., own email) in v2. For v1 the approval is the safety.

**R6 RESOLVED (2026-04-23):** per-user private workspace shipped on this branch as a Day 0 prerequisite (PR #97 / commit 16b58c8, migration `20260423130000_private_workspaces.sql` + `ensurePrivateWorkspace` helper gated by `isTeamBetaEmail`). No route wires the helper yet; the workspace switcher lands in the shell-UX spec follow-up.

**R8: Coexistence with the NIQ promo / decimal hardening commit.** The `22406d5` commit (Apr 22 22:38) added 11 new prompt bullets and two domain-knowledge packs covering promo storytelling, claim-chart binding, and decimal policy. This spec's system-prompt injection is additive and coexists with those. But the implementation agent must verify after edit that:
- All 11 existing promo/decimal bullets are still present in `system-prompt.ts:1310+`.
- Both knowledge pack entries `niq-promo-storytelling-playbook.md` and `niq-decimal-policy.md` remain in the `KNOWLEDGE_PACK_FILES` array at the top of `system-prompt.ts`.
- The `claim-chart-alignment-validator.ts` continues to run on every slide, including slides backed by `firecrawl:` or `graph:` evidence.
- Eval harness tests added in the same commit (`scripts/test-eval-harness.ts`, `scripts/test-metric-presentation.ts`, `scripts/test-slide-plan-linter.ts`, `scripts/test-cost-guard.ts`) still pass after the research layer is wired in.

If any of those are disturbed, stop and reconcile with Marco before continuing. This is a recent quality hardening; undoing it silently would be a quality regression Rossella will notice on the next run.

**R7: Graph-first retrieval quality is bounded by extraction quality.** The graph-first planner (§5.2) only works if `extractEntitiesFromDocument` at `apps/web/src/lib/workspace/extraction.ts:119-160` reliably pulls FMCG-specific entities from Italian trade press articles. If the extractor misses "private label," "ROS," "value share," or Italian retailer names like "Esselunga" on 40%+ of scraped articles, the graph falsely concludes we have coverage when we don't, and real gaps go unscraped. V1 recall at 43.2% (per `docs/2026-04-20-workspace-v2-research.md`) is already a known quality issue.

Mitigation plan:
- **Day 1 of fetcher work:** measure extraction precision and recall on 20 sample scrapes across 5 different Italian trade-press sources. Hand-label the ground truth, compare to extractor output.
- **If recall < 75% on FMCG entities:** upgrade the extractor prompt with Italian-FMCG-specific few-shot examples from `docs/domain-knowledge/niq-storymasters-basquio-agent-skill.md` and the FMCG column registry at `packages/intelligence/src/column-registry.ts` before enabling graph-first mode in production.
- **If still < 75% after prompt tuning:** disable the graph-first step (fall back to scrape-every-time) and ship the fuzzy/phonetic/embedding entity-resolution cascade from `docs/motion2-workspace-architecture.md §7` as prerequisite.
- **Ongoing:** log `extraction.entity_precision_sample` per scrape (sample rate 10%) to telemetry so Rossella can see extraction quality trending over time. If it drops below 70% sustained over a week, auto-disable graph-first until it's fixed.

The graph-first optimization is the cost lever that makes this system scale. Without it, every deck pays full scrape cost forever. With it, scrape cost decays toward zero per-workspace as the graph matures. Extraction quality is the hinge.

**R9: Fiber AI ToS stability and rate limits.** Fiber is currently LinkedIn-partnered and the right legal posture for v1, but the LinkedIn enforcement landscape shifted three times in 2025 (Proxycurl shut down July, Apollo and Seamless banned March). Mitigation: (a) if Fiber goes offline, the `linkedin_fiber` source_type rows are disabled catalog-wide by the research package's config validator and the workspace degrades gracefully without LinkedIn intelligence; (b) audit rate-limit usage monthly via Fiber's chargeInfo payload so we detect quota squeeze early. Webhook-driven job-move alerts are explicitly out of scope until post-revenue (Coresignal territory, $1k-3k per month).

**Q1: What's the Firecrawl account tier?** The spec assumes Standard or higher (50 concurrent browsers, 500 scrape req/min, 50 crawl req/min). Verify before Day 2.

**Q2: Who approves the v1 catalog seed?** The 18 sources in §3.4 are Agent-verified scrapable on 2026-04-22. Rossella or Veronica should sanity-check the list once before the seed migration ships. They may swap out lower-trust-score sources for ones they actually cite at NIQ/Mondelez/Victorinox.

**Q3: Rate limit for `saveFromPaste`?** None proposed. Users can paste as much as they want. If abuse emerges, add 500 pastes/day/user cap in v2.

**Q4: What happens when a scope gets deleted?** `ON DELETE CASCADE` from `workspaces.id` in new tables handles catalog + scrapes + research_runs cleanup. Memory entries already cascade. Entities and facts do NOT cascade on scope delete (they're workspace-scoped). Confirm this is the desired behavior.

**Q5: Does port-louis (deck generation service) consume `renderedBriefPrelude` from the pack today?** Audit shows the prelude is built but its downstream use is not visible. Verify during Day 5 integration. If unused, this spec removes the need for it by injecting the `<external_evidence>` block directly.

**Q6: NIQ services catalog review owners.** The v1 stub in `docs/domain-knowledge/niq-services-catalog.md` ships with a pending-review top-of-file notice and a 7-day window for Rossella and Francesco to replace public NIQ product names with their internal service list. The `suggestServices` tool renders a footer noting the pending review until the notice is removed. Blocker for marking `suggestServices` production-ready: Rossella and Francesco sign-off.

**Q7: Microsoft Graph / Gmail / Calendar connectors moved from V2 to V1.5.** Per motion2-workspace-architecture.md §5 update on 2026-04-23: email, Teams, and calendar ingestion is no longer post-€10k-MRR. It ships immediately after chat + research + shell UX lands, because Rossella's Workspace.xlsx feedback positioned these as core enterprise knowledge sources rather than nice-to-have. Not a v1 blocker. Added to the backlog with priority upgrade; the existing CASA assessment cost estimate remains valid.

---

## 11. Summary for the implementation agent

You are building a coupled chat-and-research layer on top of an already-shipped workspace. Do not rebuild what exists. Extend:

- 8 new chat tool entries (14 tool families total after keeping teachRule for backward compat) plus 8 approval/result-card UI components plus 1 system prompt revision. New entries: saveFromPaste, scrapeUrl, editRule, editStakeholder, createStakeholder, draftBrief, explainBasquio, suggestServices.
- 1 new package `packages/research/` with planner + fetcher + evidence adapter + Firecrawl client + Fiber client + NIQ services catalog parser
- 3 migrations: source_catalog (with `linkedin_fiber` source_type), source_catalog_scrapes, research_runs + 1 seed migration (18 verified active sources + 7 Rossella-named sources pending verification + 6 paused)
- 1 new phase `research` in `generate-deck.ts` between normalize and understand
- 1 source catalog viewer page + 1 telemetry row + 1 memory mini-panel
- 1 upgrade to `synthesizeBrief` to actually use `preferences.structured`
- 1 new knowledge pack `docs/domain-knowledge/niq-services-catalog.md` (stub shipped 2026-04-23, pending Rossella and Francesco review)

Existing contract you must honor:

- AI SDK v6 tool calling pattern at `agent-tools.ts`
- EvidenceRef schema at `insights.ts:26-39` and validator at `:115-152`
- Single-call deck architecture per `rules/canonical-rules.md:65-72`
- Working rules: no em dashes, no emojis, Phosphor icons only, spec-before-build

Estimated effort: 10 working days for v1 + 5 stretch days for catalog onboarding tooling.

When in doubt, read the forensic audit in §2 and confirm against the actual file before writing. This spec is an outline; the code is the source of truth.
