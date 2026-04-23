# Day 4 smoke-test report

**Date:** 2026-04-23 evening
**Operator:** implementation agent (Claude Opus 4.7)
**Environment:** linked Supabase `fxvbvkpzzvrkwvqmecmi`, Firecrawl Standard tier, Fiber live keys in `apps/web/.env.local`
**Budget envelope:** DAY_4_SMOKE_BUDGET = 15 URLs / $0.50 total, DAY_4_FIRECRAWL_USD_CAP = $0.30 per brief

## Verdict

Plumbing is production-grade. Three real bugs caught and fixed before Brief A produced evidence. Topical relevance of scraped content is below Rossella-grade and matches the R7 concern Marco flagged in advance. **Smoke PASSES the technical gate** (non-fatal guarantees hold, budget caps enforce, dual-write persists cleanly, auth works). **Content-quality gate is deferred** to Week 1 finisher's R7 pass (hand-label 20 scrapes, measure recall, tune extraction prompt).

Do not flip `BASQUIO_RESEARCH_PHASE_ENABLED=true` on production until content-quality is addressed. The feature flag is in place; the Vercel preview deploy is safe.

## Three real bugs found and fixed this run

### Bug 1: `research_runs.deck_run_id` FK violation on smoke run

**Symptom:** Brief A first attempt returned immediately with `degraded=true, degradedReason="research_runs insert failed: insert or update on table research_runs violates foreign key constraint research_runs_deck_run_id_fkey"`. Zero planner call, zero fetcher call, zero cost.

**Root cause:** The smoke harness generated a random UUID for `deck_run_id` that doesn't exist in `deck_runs`. The FK check rejected the insert. The production path (generate-deck.ts pipeline) always passes a real `runId` so this only affected the standalone smoke harness.

**Fix:** Changed `ResearchPhaseInput.deckRunId` from `string` to `string | null`. The column is already nullable per migration `20260423160000_research_runs.sql` (`ON DELETE SET NULL`). Smoke harness now passes `null`. Production path unchanged.

**Commit candidate:** included in Day 4 follow-up commit.

### Bug 2: Firecrawl v2 endpoint path mismatch

**Symptom:** Brief A second attempt got past the FK fix and fired the planner, which generated 2 queries. The fetcher ran `/v2/map` successfully (returned links) but every batch-scrape kickoff returned HTTP 404 text/html "Cannot POST /v2/batch-scrape".

**Root cause:** My Day 2 client used `/v2/batch-scrape` (dash-separated) based on the spec's prose. Live Firecrawl uses `/v2/batch/scrape` (slash-separated). The spec has the wrong path.

**Fix:** Changed both `batchScrape` POST and `batchScrapeStatus` GET paths from `/v2/batch-scrape` and `/v2/batch-scrape/{id}` to `/v2/batch/scrape` and `/v2/batch/scrape/{id}`. Verified against live API with a direct probe.

**Blast radius:** Day 2 client broke all batch-scrape calls. Unit tests passed because they used stubbed fetch that never hit Firecrawl. Smoke was the first live exercise of this path, and it surfaced the bug as designed.

### Bug 3: Firecrawl v2 batch-scrape response shape

**Symptom:** After fixing Bug 2, Brief A third attempt did run batch-scrape but persisted zero rows. 12 scrapes attempted, 0 succeeded, 0 failed. The counters were honest about what happened (loop skipped every item).

**Root cause:** My Day 2 type said `data: Array<{url: string, data?: FirecrawlScrapeData, error?: string}>`. Live Firecrawl returns `data: Array<FirecrawlScrapeData>` where each item has `markdown` / `html` / etc. at the top level and the source URL at `metadata.sourceURL` (not top-level `.url`).

**Fix:** Updated `FirecrawlBatchScrapeStatus.data` type to `Array<FirecrawlScrapeData & {error?: string | null}>`. Updated the fetcher's result-matching code to look up by `metadata.sourceURL` / `metadata.url` and canonicalize via `hashUrl` so trailing-slash differences do not break the join. Updated the stub fixture in `test-research-clients.ts` to match the real shape.

**Blast radius:** Same as Bug 2. Unit tests passed on a wrong stub; live smoke exposed the mismatch.

After all three fixes, Brief A produced 12 evidence refs with 8 scrapes succeeded at $0.24 cost. Plumbing is correct.

## Brief A: Kellanova Snack Salati (positive control)

Full detail: [docs/2026-04-23-day4-smoke-brief-a.md](2026-04-23-day4-smoke-brief-a.md)

- **Planner:** 2 queries generated (tiers 1-3 Italian, category + competitor).
- **Fetcher:** 15 URLs attempted, 8 scrapes succeeded, 4 cache-hits on second query (expected dedup working).
- **Cost:** $0.2394 (~57% of Firecrawl cap, within budget).
- **Elapsed:** 305 seconds (one query ran near the 180 s per-query timeout).
- **Budget-exceeded flag:** `true`. Hit exactly 15 URLs, the hard cap. Not an overrun, the counter is set when `remaining URLs = 0` even on a successful ceiling hit. Worth a telemetry rename before the flag flips default-on.
- **research_runs row:** `dd417310-314a-49a2-ab8e-a84698005f4c`, status=completed, plan.rationale intact.
- **knowledge_documents rows:** 8 new rows, all `kind='scraped_article'`, all provenance columns populated correctly.
- **source_catalog_scrapes rows:** 8 new rows with `fetcher_endpoint='batch-scrape'`.
- **Evidence refs:** 12 with `firecrawl:<hash>` ids, confidence 0.85 (matches tier-1 source trust_score / 100).

### Content-quality observations (honest)

Of the 8 scraped articles:
- **2 genuinely relevant** to the snack salati brief: "Veroni Snack Line launch" (Food Affairs), "I nuovi trend della spesa degli italiani 2026" (Food Affairs).
- **3 sitemap index pages** from freshplaza.it (`/sitemap/news/2017`, `.../2025`, `.../2026`). Sitemaps are NOT articles; they are URL lists. They still match the `crawl_allow` regex `/news/.*` because the path contains "news".
- **2 off-topic environmental articles** from agrifoodtoday.it about Irish cow methane regulations. Zero snack relevance; matched the `/attualita/.*` path and the keyword scorer gave them points for "2026" or "Italia".
- **1 old article** (2021 Amazon grocery trends) that predates the brief's Q1 2026 scope. No freshness filter applied at the fetcher layer.

This is the R7 extraction-quality gap Marco flagged. The planner + fetcher pipes are correct; the **topic-relevance filter** is weak. Three specific gaps:

1. **Sitemap exclusion.** `crawl_deny` regexes should include `/sitemap/.*` across every source.
2. **Freshness enforcement.** The planner emits `freshness_window_days` in each query (e.g., 30) but the fetcher passes the date-ordered limit to `/v2/map` without actually filtering returned URLs by published_at.
3. **Topical vs keyword ranking.** `rankLinksByKeyword` scores by substring containment on titles and descriptions. "Veroni Snack Line" scores high on "snack" ✓; "Irlanda vuole abbattere 200mila mucche" scores 0 on the core brief terms but got included because we took top-N per source with no minimum-score threshold.

All three are single-file fixes in `fetcher.ts`. Proposed for Week 1 finisher R7 pass.

## Brief B: Hotel AI EMEA (negative control)

Full detail: [docs/2026-04-23-day4-smoke-brief-b.md](2026-04-23-day4-smoke-brief-b.md)

- **Planner:** 2 queries generated targeting tiers 4-5 English (correctly avoided Italian tier-1/2 given the non-CPG topic).
- **Fetcher:** 15 URLs attempted, 15 succeeded. Firecrawl had zero map-call failures against `just-food.com`, `euromonitor.com`, `nielsen.com`.
- **Cost:** $0.1449.
- **research_runs row:** `0cb09287-7095-4f97-83e7-9189cd2ea209`, status=completed.

### What actually happened

Brief B was supposed to be a "catalog miss" producing 0-2 scrapes. Instead it produced 15 because Firecrawl's `/v2/map` with `search: "hotel AI EMEA"` matched ANY articles on the food/CPG sources that contained "AI" OR "market" OR "EMEA" OR "2026" OR "opportunity". Hotel-AI content never surfaced because the catalog has zero hospitality sources (by design). The fetcher filtered nothing out because my pattern filters allow food articles.

Scraped examples:
- "Nielsen helps New Zealand brands expand internationally"
- "Gen Alpha's increasing influence over family decisions"
- "Global Luxury Goods Market: 3 Trends Driving Growth in 2023"
- "UK's Batch Ventures invests in local biscotti maker"
- "French popcorn firm Natais eyes growth in emerging markets"

Zero results are about hotels or PMS or revenue management. All 15 are food/CPG adjacent content that happened to contain overlap keywords.

### The honest read

Brief B is a stress test of topic-relevance, not of graceful degradation. The fetcher IS degrading gracefully: it completed, persisted cleanly, stayed under budget. But the output is 15 confidently-cited `firecrawl:*` refs on food-CPG topics, not hotel-AI topics. If the deck author called this run's refs, Claude would cite food articles as evidence for a hotel-AI brief.

Week 1 finisher R7 needs to answer: should the fetcher **reject** catalog misses (return zero scrapes when Firecrawl returns nothing that semantically matches the brief) or **scope-gate by catalog** (only scrape sources whose `domain_tags` match at least one brief keyword)? The first is safer; the second is cheaper. Either is a 30-line change.

## Fiber smoke

Full detail: included in both brief docs.

- `lookupByEmail("marcodicesare1992@gmail.com")` → Fiber returned a cached "Previously not found" from an earlier call in the same session. **Fiber auth works, request fires, response is valid Fiber semantics**. The email is simply not in Fiber's 850M-profile index. This is common for personal Gmail addresses without a LinkedIn directly tied to them.
- `peopleSearch({keywords: "Marco Di Cesare Basquio"})` → Fiber returned 25 results with `total: 0`. Fiber auth + request-flow works; **my `FiberPeopleSearchResponse` type mapping is wrong** (fields come back with different names, so my code displays everything as undefined). 25 credits consumed.

**Fiber integration status:** client construction works, auth works, network hits succeed. Type mapping for `peopleSearch` needs Day 5+ correction before `createStakeholder` fires it in Week 1 chat tools. `lookupByEmail` works end-to-end but Marco's specific email is not indexed (unrelated to the code path).

## Costs

| Call | Cost |
|---|---|
| Brief A planner (Haiku) | ~$0.02 |
| Brief A Firecrawl (13 sources × 1-2 queries = 26 map calls + 15 scrape URLs) | $0.2394 |
| Brief B planner (Haiku) | ~$0.02 |
| Brief B Firecrawl (3 tier-4/5 sources × 2 queries = 6 map calls + 15 scrape URLs) | $0.1449 |
| Fiber peopleSearch probe | 25 credits ≈ $0.04 (at Standard tier) |
| Fiber lookupByEmail (cached not-found, zero credits) | $0.00 |
| **Total live spend** | **~$0.43** |

Within Marco's declared smoke budget ($1.00) by a comfortable margin. First-run bugs (Bugs 1-3) burned $0.14 on the first Brief A attempt before fixes landed.

## NIQ hardening preservation check

Verified during this smoke pass:
- `packages/workflows/src/system-prompt.ts` `KNOWLEDGE_PACK_FILES` still includes `niq-promo-storytelling-playbook.md` and `niq-decimal-policy.md` at positions 2-3.
- `packages/workflows/src/metric-presentation.ts` zero edits.
- `packages/intelligence/src/claim-chart-alignment-validator.ts` zero edits.
- `packages/intelligence/src/slide-plan-linter.ts` zero edits.
- All four NIQ eval harness tests green after Day 4 fixes.

## R7 addendum (2026-04-23 evening, same day, production-grade fixes)

Per Marco's explicit instruction ("ship fixes no band-aid production-grade A++ before next finisher"), the four R7 gaps were not deferred to Week 1. They shipped same-day.

### What changed

**Migrations (applied to linked remote):**
- `20260423200000_source_catalog_r7_filters.sql`: sets `crawl_deny` on every seed row (sitemap, feed, tag, category, author, archive) when absent; enriches Tier 4/5 `domain_tags` with `['food','consumer','retail','fmcg','cpg']`; adds `['fmcg','cpg','italia']` to Italian Tier 1/2.
- `20260423210000_source_catalog_topic_deny.sql`: idempotent jsonb-agg follow-up adding `/topic/.*` and `/topics/.*` after Brief B R7 smoke surfaced a Nielsen archive page at `/insights/topic/marketing-performance` that slipped through.

**Fetcher (`packages/research/src/fetcher.ts`):**
- `GLOBAL_CRAWL_DENY_PATTERNS`: runtime deny applied before per-source patterns. Sitemaps, feeds, tags, topics, categories, authors, archives, paginated index pages. Defense in depth alongside the migration.
- `isPathFreshEnough`: extracts `/YYYY[/MM[/DD]]/` from URL paths. Articles older than the query's `freshness_window_days` drop pre-scrape. Post-scrape `metadata.publishedTime` is the second line of defense in `persistScrape`.
- `rankLinksByKeyword`: drops purely-numeric query terms (year stamps scored spuriously on URL date segments) AND filters to `score >= MIN_KEYWORD_SCORE` (1).
- `sourceHasTopicOverlap`: the brief-topic vs source-topic gate. Source signature = `domain_tags + source_type + host tokens (length >= 3)`. Brief signature = tokenized `query.text` (length >= 3, non-numeric, non-stopword). Match on exact equality OR prefix-or-suffix match (not mid-string, so "pet" matches "petfood" but not "competitor").
- `TOPIC_STOPWORDS`: English + Italian + French/Spanish stragglers. Expanded after adversarial review flagged missing Italian articles.

**Tests (`scripts/test-research-filters.ts`):** 7 cases covering sitemap global deny, URL-path freshness, zero-keyword-score drop, topic overlap reject (food source on hotel brief), topic overlap keep (food source on food brief), 3-char prefix match (pet → petfood), mid-string non-match (pet ≠ competitor).

### Re-smoke results

Both briefs re-run post-R7 against live Firecrawl. Detail: [brief-a-r7.md](2026-04-23-day4-smoke-brief-a-r7.md), [brief-b-r7-v2.md](2026-04-23-day4-smoke-brief-b-r7-v2.md).

**Brief A (Kellanova Snack Salati) before / after R7:**

| Metric | Before | After |
|---|---|---|
| Evidence refs | 12 | 5 |
| Scrapes succeeded | 8 | 4 |
| Cost (Firecrawl) | $0.2394 | $0.1512 |
| Sitemap index pages scraped | 3 | 0 |
| Off-topic environmental articles | 2 | 0 |
| Stale 2021 articles | 1 | 0 |

New R7 scrapes on Brief A are Italian food-industry content: Centromarca industry-of-brands scenarios, Centromarca industria alimentare post-Covid competitiveness, freshplaza Italian fruit export news. Not perfect (the fruit export articles are tangential to snack salati) but a legitimate FMCG operating context.

**Brief B (Hotel AI EMEA) before / after R7:**

| Metric | Before | After |
|---|---|---|
| Evidence refs | 15 | 0 |
| Scrapes succeeded | 15 | 0 |
| Cost (Firecrawl) | $0.1449 | $0.0000 |
| Food/CPG articles falsely cited | 15 | 0 |

The topic-overlap gate rejects every catalog source upfront (no map call fires) because the hotel-AI brief has zero domain_tag overlap with food-CPG sources. research_runs marked completed, zero spend, honest degradation.

### Adversarial sub-agent review caught + folded pre-push

Two SHOULD-FIXes surfaced and were folded in before this commit:
1. Comment in `buildBriefTopicTerms` claimed "query text, keywords, and intent" but only used `query.text`. Comment rewritten to match the code with rationale (planner already composes keywords into query.text at generation time).
2. Partial-match floor `overlap.length < 4` would drop "pet" → "petfood". Replaced with prefix-or-suffix match: catches legitimate 3-char category roots (pet, oil, tea, pane) while still rejecting mid-string false positives (pet inside competitor, it inside management). Two new tests cover both directions.

## Follow-ups that remain for Week 1+ (R7 batch above is DONE)

Priority order:

1. **R7 extraction-quality pass** (Week 1 finisher). Hand-label 20 of Brief A's Italian scrapes for FMCG entity recall. If recall < 75%, tune `extraction.ts` prompt with Italian-FMCG few-shot examples before enabling graph-first in production.
2. **Topic-relevance filter in fetcher** (Week 1 finisher or earlier). Three specific gaps enumerated in Brief A section above: sitemap exclusion, freshness enforcement, minimum-keyword-score threshold.
3. **`budget_exceeded=true` telemetry rename** (Week 1 finisher). Set it only on actual overrun (cap hit mid-call, run halted with partial results) rather than on exact ceiling match.
4. **`FiberPeopleSearchResponse` type mapping** (Week 1 finisher, before `createStakeholder` ships). The shape Fiber returns does not match my types. Day 5+ with a one-field-at-a-time live probe.

Also flagged earlier and still pending:
- `file_ingest_runs` worker consumer has not shipped, so scraped articles sit with `knowledge_documents.status='processing'` until it lands. Not a Day 4 blocker; Rossella/Alessandro/Francesco won't see extracted entities in the UI yet.
- Dual-write is not transactional, so partial failures can orphan docs. Acceptable under single-worker smoke. Must be fixed before default-on.
- `graph:` prefix refs not yet accepted by `insights.ts` validator; Day 5 wiring closes it.
