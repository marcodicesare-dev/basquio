# Motion 2 — Workspace Architecture (the Veronica vision, engineered)

**Version:** 1.0
**Locked:** 2026-04-19
**Source of truth:** this file + [docs/strategy-basquio-motions.md](strategy-basquio-motions.md)

This is the technical architecture for Motion 2 — the Workspace SaaS (Legora model, laddered). The product thesis: **Basquio is a wrapper that becomes indispensable because it engineers the analyst's working memory**. Frontier models provide intelligence; Basquio's moat is the memory and context engineering.

Every architectural choice below is sourced to a verified 2025-2026 reference. Engineering opinions are flagged.

---

## 1. Product thesis (locked)

> The product is the workspace where the analyst lives, not the deck generator. The deck falls out when someone asks for a deck. The moat is cross-session + cross-client memory that compounds over months, grounded in frontier-model intelligence.

Veronica's Apr 18 framing, verified against current state of the art:

- **Karpathy** defines the category: *"Context engineering is the delicate art and science of filling the context window with just the right information for the next step"* ([X post Jun 25 2025](https://x.com/karpathy/status/1937902205765607626?lang=en), [MIT Tech Review synthesis Nov 2025](https://www.technologyreview.com/2025/11/05/1127477/from-vibe-coding-to-context-engineering-2025-in-software-development/))
- **Simon Willison** reframes it: *"context engineering will stick"* — the developer's job is managing what the model sees, not writing prompts ([Willison tag](https://simonwillison.net/tags/context-engineering/))
- **Harvey** announced Memory product Jan 2026 with three scopes: per-matter, institutional, client-institution ([LawSites](https://www.lawnext.com/2026/01/harvey-announces-plan-to-develop-memory-enabling-users-to-retain-context-for-more-consistent-work.html), [Artificial Lawyer — $190M ARR, 1000+ customers](https://www.artificiallawyer.com/2026/01/08/harvey-hits-190m-arr-building-memory-personalisation/))
- **Rogo** acquired Offset Mar 2026 specifically for "agentic memory about how financial models are constructed, updated, and maintained over time" ([PR Newswire](https://www.prnewswire.com/news-releases/rogo-acquires-offset-to-bring-ai-agents-into-financial-workflows-302713749.html))
- **Granola** pivoted from "meeting notetaker" to "enterprise AI app" at Series C $125M / $1.5B valuation Mar 25 2026, anchor feature = Spaces (scoped workspaces with access controls) ([TechCrunch](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/))

**Basquio's angle that nobody else claims today: "the CPG analyst's second brain."** Harvey owns legal, Granola owns meetings, Glean owns enterprise search, nobody owns the CPG insights analyst's durable memory.

---

## 2. Memory substrate — bi-temporal facts in Postgres for V1

**V1 (ships now): Postgres `facts` table with bi-temporal columns. NOT Graphiti.**

Rationale: V1 targets first 10-50 customers. Marco ships in hours/days using the existing Supabase + pgvector stack. Bringing Graphiti in V1 means adding Python + Neo4j + a new infrastructure layer to learn for zero incremental value at this scale. Postgres does bi-temporal facts natively with two timestamp columns and proper indexing.

**V1 schema (~60 lines):**

```sql
ALTER TABLE knowledge_documents ADD COLUMN organization_id UUID NOT NULL;
ALTER TABLE knowledge_chunks ADD COLUMN organization_id UUID NOT NULL;
ALTER TABLE transcript_chunks ADD COLUMN organization_id UUID NOT NULL;

CREATE TABLE entities (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  type TEXT NOT NULL, -- person, brand, category, retailer, metric, deliverable, question
  canonical_name TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE entity_mentions (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  entity_id UUID REFERENCES entities(id),
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  excerpt TEXT,
  mentioned_at TIMESTAMPTZ,
  confidence REAL DEFAULT 1.0
);

CREATE TABLE facts (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  subject_entity UUID REFERENCES entities(id),
  predicate TEXT NOT NULL,
  object_value JSONB,
  valid_from TIMESTAMPTZ,       -- event time
  valid_to TIMESTAMPTZ,          -- null = still valid
  ingested_at TIMESTAMPTZ DEFAULT now(),  -- when Basquio learned it
  source_id UUID,
  superseded_by UUID REFERENCES facts(id)
);

CREATE TABLE memory_entries (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  scope TEXT NOT NULL,  -- 'analyst', 'client:Victorinox', 'category:Kitchen', 'workspace'
  memory_type TEXT NOT NULL,  -- 'semantic', 'episodic', 'procedural'
  content TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON facts USING GIN (organization_id, subject_entity, predicate);
CREATE INDEX ON entity_mentions (organization_id, entity_id);
CREATE INDEX ON memory_entries USING hnsw (embedding vector_cosine_ops);
```

**V2 migration path (if scale demands):** only migrate to Graphiti + Neo4j when (a) we have 50+ workspace customers, (b) cross-entity multi-hop queries become >10% of generation-time queries, and (c) Postgres query latency exceeds 500ms on the fact table at that scale. Most V1 customers will never hit this.

**V1 uses Anthropic Memory Tool as the "agent-facing" memory interface.** Claude reads `/memories/{org_id}/{scope}/` which is a virtual filesystem backed by the `memory_entries` table. Agent writes learnings back as plain markdown. ZDR-eligible per Anthropic. ([Memory Tool docs](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool), [Context management announcement](https://www.anthropic.com/news/context-management) — +39% agentic search lift, 84% token reduction on 100-turn eval.)

**Graphiti remains the reference V2+ target.** Open-source bi-temporal KG engine, MCP-compatible. When we migrate, the Postgres facts table maps cleanly to Graphiti's edge model (every edge has event-time + ingestion-time). The V1 schema is designed to be Graphiti-compatible on migration. ([getzep/graphiti](https://github.com/getzep/graphiti), [arXiv 2501.13956](https://arxiv.org/abs/2501.13956))

**Entity taxonomy (locked):**
- **Analyst** (the user)
- **Organization** (client brand, retailer, agency, NIQ/Kantar/Circana vendor)
- **Person** (stakeholder — CMO, Head of Category, external consultant, colleague)
- **Category / Sub-category** (FMCG category hierarchy — uses existing `docs/domain-knowledge/fmcg-cpg-market-intelligence-supergraph.md`)
- **Brand** (specific brand the analyst tracks)
- **SKU** (if granular enough)
- **Retailer** (Coop, Conad, Esselunga, etc. for Italian context)
- **Metric** (sales value, share, distribution, ROS — uses existing `packages/intelligence/src/column-registry.ts`)
- **Deliverable** (past deck, memo, workbook produced by Basquio or by the analyst)
- **Question** (analytical question asked, linked to the deliverable that answered it)
- **Fact** (time-bounded statement: "Brand X share at Retailer Y in Q3 2025 = Z%")
- **Meeting / Email / Document** (the source communication that produced the fact)

**Relations (locked):**
- `stakeholder_of` (Person → Organization, role + tenure)
- `analyst_works_on` (Analyst → Brand / Category / Client)
- `mentioned_in` (any entity → Meeting / Email / Document)
- `succeeds` (Fact supersedes prior Fact at new event time)
- `derived_from` (Deliverable derived from source Facts)
- `asked_by` (Question asked by Person at time T)
- `answered_in` (Question answered by Deliverable at time T)

---

## 3. Memory scopes (Harvey template, applied to FMCG)

Directly copied from Harvey's Jan 2026 Memory product design, because the underlying problem shape is identical.

| Scope | Harvey equivalent | Basquio definition | Retention default |
|---|---|---|---|
| **Analyst** | User-specific preferences | Individual analyst's preferences, shorthand, favorite charts, tone | Indefinite (user-owned) |
| **Client-Brand** | Client-institution | Everything about a specific brand the analyst covers — KPI dictionary, prior briefs, prior decks, stakeholder map | 24 months |
| **Category** | Matter-specific | Everything about a specific category/project — e.g. "Q1 Snack Salati review for Kellanova" | Per-project + 12 months |
| **Workspace** | Institutional | Firm-wide norms — brand template, signature style, source-citation rules, glossary | Indefinite (org-owned) |

Each memory is scoped to exactly one scope. Queries at generation time can union scopes (e.g., "generate a deck for Kellanova Snack Salati" reads Analyst + Kellanova + Snack Salati + Workspace). Retention windows per scope are configurable per workspace admin.

**Reference:** Harvey's [Memory announcement](https://www.lawnext.com/2026/01/harvey-announces-plan-to-develop-memory-enabling-users-to-retain-context-for-more-consistent-work.html) — "Adoption of the new Memory feature will be entirely optional and users will retain full autonomy. When it is turned on, Harvey will be able to reference past threads within a firm's defined retention window to inform new questions. This capability can be scoped at a granular level, such as to a specific user, client or matter."

**Basquio inherits the optional-adoption + retention-window + granular-scope properties.**

---

## 4. Memory types (LangMem taxonomy)

Semantic / episodic / procedural split per LangChain's formalization ([LangMem conceptual guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/), [launch post](https://blog.langchain.com/langmem-sdk-launch/)).

| Type | What it stores | CPG analyst examples |
|---|---|---|
| **Semantic** | Facts, entities, relationships | "Kellanova Italy CMO is [name] since 2024"; "Category X Q3 share = Y%"; "Retailer Z is our priority for 2026" |
| **Episodic** | Distilled past interactions as few-shot examples | "Last time we pitched pasta category review, the winning angle was Mediterranean premiumization" |
| **Procedural** | Agent behavior norms, updates to system prompt | "When Alessandro asks for a NIQ RMS read, always check 52-week and exclude private label unless told otherwise"; "Giulia prefers charts with source callouts bottom-left" |

Procedural memory is what makes Basquio "learn the analyst" over time. Each successful interaction distills a procedural hint that refines subsequent generations for that user.

---

## 5. Ingestion layer — communications channels

**Locked stack per [Apr 19 2026 research](strategy-basquio-motions.md#references):**

### Email + Calendar + Drive

- **Microsoft 365** (Outlook + Teams mail + OneDrive + SharePoint + Outlook Calendar): single Microsoft Graph integration covers all. Subscription-based change notifications (TTL ~3 days, requires refresh jobs). Delegated or application permissions. ([Graph subscription docs](https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions?view=graph-rest-1.0), [change-notifications overview](https://learn.microsoft.com/en-us/graph/change-notifications-overview))
- **Gmail + Google Calendar + Drive**: Gmail API with `gmail.metadata` scope first (labels + headers, no bodies) to minimize privacy footprint; upgrade to `gmail.readonly` only when user opts in per specific label. Drive uses `changes.watch` with `pageToken`. Reconcile via `pageToken` polling — [known webhook reliability gap](https://discuss.google.dev/t/google-drive-webhooks-only-send-the-initial-sync-never-update-am-i-missing-something-obvious/288347).
- **Gmail CASA assessment required** for commercial production use of restricted scopes: $500-$75K per assessor, annual renewal ([GMass verification writeup](https://www.gmass.co/blog/google-oauth-verification-security-assessment/), [Nylas guide](https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide/)). Budget €5-15k for first CASA pass before Motion 2 enterprise launch.

### Slack

- OAuth 2.0 + Events API push + `conversations.history` backfill.
- **Critical regression (May 29 2025)**: non-Marketplace commercial apps are rate-limited to **1 req/min, max 15 items** on history/replies ([Slack changelog](https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq)). Marketplace-approved apps keep the old 50+ req/min limit.
- **Basquio decision: submit to Slack Marketplace before first paid Motion 2 customer**. Historical backfill is impossible at scale without Marketplace approval.

### Notion

- Internal integration tokens, webhooks available (do not count against rate limit) ([Notion request limits](https://developers.notion.com/reference/request-limits)).
- 3 req/sec sustained, 2,700/15min per integration token.
- **Pattern**: one token for sync background, separate token for user-facing reads.

### Meetings — use Recall.ai as infrastructure

- **[Recall.ai](https://www.recall.ai/pricing)** is the Stripe of meeting bots. Supports Zoom, Google Meet, Teams, Webex, GoToMeeting, Slack Huddles.
- Pricing: $0.50/hr recording + $0.15/hr transcription + $0.05/hr storage after 7 free days. First 5 hours free.
- Do not build meeting bots from scratch. This is unambiguous.
- **Fast-follow: bot-free capture option** à la Granola (Mac local audio, never joins as a bot). This is the "no visible intrusion" pattern that separated Granola from Fireflies/Otter in 2025-2026 and drove the $1.5B valuation ([TechCrunch](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/)). Basquio MVP ships bot-only; bot-free is Q3 2026 feature.

### Consent + legal posture

- **GDPR Art. 6 basis** for ingesting work email/meetings: legitimate interest (professional communications used for professional AI workspace), documented in the DPA.
- **GDPR Art. 5.1.c data minimization**: framing for the user = "We only ingest what you flag as work context — specific Gmail labels, specific Slack channels, specific Drive folders. We never read un-flagged inboxes. Meetings are recorded only when you opt in."
- **Meeting recording consent (US)**: 12 all-party-consent states verified (CA, DE, FL, IL, MD, MA, MI, MT, NH, OR, PA, WA per [Recording Law](https://www.recordinglaw.com/party-two-party-consent-states/)). Production default = "all parties notified at meeting start" with opt-out UI.

---

## 6. Connector plumbing — build vs buy decision

**Locked: start with [Nango](https://www.nango.dev/) for auth plumbing + native Microsoft Graph on critical path.**

Rationale:
- Nango is code-first + open-source ([customers: Replit, Ramp, Mercor](https://www.nango.dev/)), $50/mo Starter + usage. No vendor lock-in. Fits the "5-person part-time, ship fast, own the code" reality.
- [Composio](https://composio.dev/) is AI-agent-native via MCP (Rube server, 500+ apps, $25M Series A 2025) — use for the MCP exposure layer, not as primary auth.
- [Paragon](https://www.useparagon.com/use-case/article/agentic-actions) and [Unipile](https://www.unipile.com/pricing-api/) are ruled out for now (pricing opacity and LinkedIn-specific respectively).
- **Native Microsoft Graph integration for Outlook + OneDrive + Calendar + Teams mail** — single integration, biggest surface, avoids Nango rate-limit overhead for the channel Italian CPG buyers use daily.

**Expose Basquio as MCP server.** MCP is production-ready per [April 2026 state](https://modelcontextprotocol.io/specification/2025-11-25) (donated to Linux Foundation Agentic AI Foundation Dec 2025, 97M installs Mar 25 2026, all major AI vendors adopted). Basquio's memory + deck generation + CRM exposed as MCP means any user's Claude Desktop / Cursor / ChatGPT agent can call Basquio, not just basquio.com.

---

## 7. Entity resolution — the quality bar

Per [research consensus](https://tianpan.co/blog/2026-04-10-graph-memory-llm-agents-relational-reasoning), production entity resolution uses a tiered cascade:

1. **Exact match** (same email, same UUID)
2. **Fuzzy match** (normalized strings: Levenshtein, Jaro-Winkler)
3. **Phonetic match** (Soundex for Italian surname variations)
4. **Embedding match** (vector similarity > threshold)
5. **LLM tiebreaker** (Claude Haiku confirms ambiguous match)

Basquio's existing contact-enrichment pipeline (`scripts/contact-enrichment.ts`, `scripts/enrich-fra-contacts.ts`) already does steps 1-3 for the outreach graph. Extend for memory entity resolution on ingestion.

**90% of "the memory feels magical" comes from entity resolution quality.** Invest here before polishing the UI.

---

## 8. Context selection at generation time

**Anthropic Memory Tool + Context Editing** is the locked in-session context management layer.

- Memory Tool released Sept 2025 beta, requires header `context-management-2025-06-27`. Exposes `/memories` directory; Claude auto-checks it before tasks. Client-side storage — Basquio controls where and how. ZDR-eligible. ([Memory Tool docs](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool))
- Context Editing (`clear_tool_uses_20250919`) prunes stale tool results during long conversations.
- Anthropic-measured lift: +39% on agentic search with memory + context editing; 84% token reduction on 100-turn web search eval ([Anthropic context management announcement](https://www.anthropic.com/news/context-management)).

**Pipeline at generation time** (for a deck request "write me the Kellanova Snack Salati Q1 2026 category review"):

1. Claude Agent SDK session starts with Basquio MCP connected
2. System prompt loads: domain knowledge pack (`niq-storymasters-fmcg`) + workspace scope memories
3. Memory Tool queries `/memories/kellanova/` and `/memories/snack-salati/` for relevant prior context
4. Graphiti KG queried for temporal facts: "What was Kellanova Snack Salati share in Q4 2025? What changed?"
5. Ingestion connectors queried for recent comms: "Any Kellanova emails past 30 days? Any meeting transcripts mentioning Q1 category review?"
6. Context assembled within Claude's context window
7. Context editing clears stale tool results as session evolves
8. Deck generated; every claim traced to source (Graphiti fact ID + source communication ID)
9. Procedural memory updated if user edits ("user prefers X over Y → remember for next time")

---

## 9. Privacy posture — non-negotiable

- **Ingestion is opt-in per channel per scope.** Default off. User explicitly flags which Gmail labels, which Slack channels, which Drive folders, which meetings are "work context for Basquio."
- **Gmail starts at `gmail.metadata` scope** (no body read) until user upgrades label-by-label.
- **Zero Data Retention** enabled via Anthropic Memory Tool's ZDR eligibility + Recall.ai's ZDR config option.
- **Audit log** per workspace admin: what was ingested, when, from where, which model invocation used it.
- **Right to forget** at scope level: user can delete Kellanova scope, all memories + Graphiti subgraph + ingested comms for that scope removed in < 24 hours.
- **SOC 2 Type I target Q4 2026** (post-€10k MRR gate, funded by revenue).

---

## 10. Tier 2a V1 build scope — calibrated to Marco's actual shipping pace

Marco ships in hours and days, not weeks. This plan respects that.

**V1 ships in 15-25 focused hours of Marco-time, spread across ~5 sessions.** Dogfooded with Veronica and Fra by end of that window.

### Session 1 — schema + workspace UI (3-5 hours)

- Migration: add `organization_id` to `knowledge_documents`, `knowledge_chunks`, `transcript_chunks`, and create `entities`, `entity_mentions`, `facts`, `memory_entries` tables (~60 lines SQL, see §2)
- Wire web-app upload endpoint to write to those tables scoped to `organization_id` from the authenticated session
- Basic workspace page: upload area (brief / meeting transcript / deck / data), "ask anything" input, recent-documents list, recent-deliverables list
- Reuse existing `hybrid_search` RPC, add `organization_id` scoping filter

### Session 2 — entity extraction + resolution (3-5 hours)

- Extraction: on every upload, invoke Claude Haiku to extract `{people, brands, categories, retailers, metrics, dates, claims}` from the document. Reuse the pattern in `apps/bot/src/extractor.ts`.
- Entity resolution V1 — exact match + normalized-string match only, LLM tiebreak only on collision. The phonetic + embedding cascade comes later.
- Write each entity to `entities`, each mention to `entity_mentions`, each temporal claim to `facts` with `valid_from` and `ingested_at`.
- UI: Timeline view shows "Basquio now knows X people, Y brands, Z claims" with clickable source links.

### Session 3 — memory layer + Anthropic Memory Tool (3-5 hours)

- Define memory scopes: `analyst`, `client:{brand}`, `category:{cat}`, `workspace` per [Harvey Jan 2026 three-scope template](https://www.lawnext.com/2026/01/harvey-announces-plan-to-develop-memory-enabling-users-to-retain-context-for-more-consistent-work.html)
- Wire Anthropic Memory Tool into deck generation path with beta header `context-management-2025-06-27`. Memory Tool sees `/memories/{org_id}/{scope}/` as virtual paths backed by `memory_entries`.
- Generator reads relevant scopes at session start. After each generation, distill procedural learnings and write back.
- Enable Anthropic Context Editing (`clear_tool_uses_20250919`) to prune stale tool results in long sessions.

### Session 4 — context-aware generation + citations (3-5 hours)

- Wire existing deck generation pipeline to read workspace context: recent uploads + entity graph + facts relevant to the user's prompt + memory scope entries
- Every claim in the generated deck links to a source_id (the document/transcript it came from)
- Output panel in workspace UI: "Generated deliverables" with source-citation hover

### Session 5 — polish + deploy + dogfood (3-5 hours)

- Scope picker in "ask anything" input (auto-inferred from prompt but user can override)
- Suggestions panel: surfaces commitments and open questions from past sessions
- Deploy to Veronica + Fra workspaces
- Dogfood for 1 week. Fix what breaks.

### What ships post-V1 (V2 scope, triggered by €10K MRR or clear user demand)

- Microsoft Graph connector (Outlook + OneDrive + Calendar + Teams mail — single integration covers all)
- Gmail connector with `gmail.metadata` scope (body read only on explicit label opt-in)
- Slack connector (after Slack Marketplace approval — mandatory for backfill per [May 2025 rate-limit regression](https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq))
- [Recall.ai](https://www.recall.ai/) meeting bot integration for auto-capture
- Entity resolution cascade (exact → fuzzy → phonetic → embedding → LLM tiebreak)
- Migration from Postgres facts table to Graphiti bi-temporal KG if scale demands
- Basquio as MCP server published to Smithery registry
- DPA template library (bilingual IT/EN)
- SOC 2 Type I kickoff
- Team admin UI (seat management, scope retention config, audit log)

---

## 11. Kill conditions for Motion 2

- **Tier 2a: zero paid customers after 90 days** → the €500/mo Team Starter is not the right entry point, reprice or reposition
- **Tier 2a customer uses Basquio < 2x/week per seat** → workspace value unclear, the real product is still the deck not the workspace
- **Entity resolution quality < 85% precision on a 500-row test set** → memory "doesn't feel magical," users abandon
- **NIQ Ask Arthur or Circana Liquid AI ships cross-source white-label by Q1 2027** → window closed, reshape thesis

---

## 12. Must-verify-before-citing list

- Graphiti MCP Server v1.0 release date (Nov 2025 per the memory research; verify from Zep blog directly before citing in deck)
- Exact Anthropic Memory Tool rate limits (claim: 100KB per memory, 8 stores — I have NOT verified this directly on Anthropic docs; research agent flagged it as unverified)
- Granola MCP server feature date (Feb 2026 per comms research; verify from Granola blog directly)
- Slack Marketplace approval timeline for vertical AI SaaS apps (public data thin)
- CASA assessment exact cost for Basquio's tier ($500-15K range is too wide)
- Recall.ai Enterprise pricing for ZDR + SOC 2 mode (public pricing is developer tier only)
- Zep vs Graphiti hosting trade-offs at 10+ workspace scale (needs own testing)

---

## 13. Sources

**Memory frameworks**:
- [Letta — Memory-first agent](https://www.letta.com/)
- [Mem0 — "AI Agents Forget. Mem0 Remembers."](https://mem0.ai/)
- [Mem0 arXiv 2504.19413](https://arxiv.org/abs/2504.19413)
- [Zep homepage — "Context Engineering"](https://www.getzep.com/)
- [Graphiti GitHub](https://github.com/getzep/graphiti)
- [Graphiti MCP Server](https://www.getzep.com/product/knowledge-graph-mcp/)
- [Zep arXiv 2501.13956](https://arxiv.org/abs/2501.13956)
- [LangMem guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)
- [Anthropic Memory Tool docs](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool)
- [Anthropic context management announcement](https://www.anthropic.com/news/context-management)

**Vertical workspace references**:
- [Harvey Memory announcement — LawSites](https://www.lawnext.com/2026/01/harvey-announces-plan-to-develop-memory-enabling-users-to-retain-context-for-more-consistent-work.html)
- [Harvey $190M ARR — Artificial Lawyer](https://www.artificiallawyer.com/2026/01/08/harvey-hits-190m-arr-building-memory-personalisation/)
- [Rogo + Offset acquisition](https://www.prnewswire.com/news-releases/rogo-acquires-offset-to-bring-ai-agents-into-financial-workflows-302713749.html)
- [Granola Series C — TechCrunch](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/)
- [Hebbia Deeper Research](https://www.hebbia.com/blog/inside-hebbias-deeper-research-agent)
- [Glean Enterprise Graph](https://www.glean.com/product/enterprise-graph)
- [Glean 7 core components](https://www.glean.com/blog/7-core-components-of-an-ai-agent-architecture-explained)

**Context engineering thesis**:
- [Karpathy on context engineering](https://x.com/karpathy/status/1937902205765607626?lang=en)
- [MIT Tech Review — From vibe coding to context engineering](https://www.technologyreview.com/2025/11/05/1127477/from-vibe-coding-to-context-engineering-2025-in-software-development/)
- [Simon Willison context-engineering tag](https://simonwillison.net/tags/context-engineering/)
- [LangChain context engineering for agents](https://blog.langchain.com/context-engineering-for-agents/)

**Infrastructure**:
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [2026 MCP Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [MCP Claude API connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
- [Nango pricing](https://nango.dev/pricing/)
- [Composio Series A](https://composio.dev/blog/series-a)
- [Recall.ai pricing](https://www.recall.ai/pricing)
- [Microsoft Graph subscription docs](https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions?view=graph-rest-1.0)
- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Slack May 2025 rate limit changelog](https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq)
- [Notion request limits](https://developers.notion.com/reference/request-limits)

**Privacy / legal**:
- [GMass — Google OAuth CASA verification cost](https://www.gmass.co/blog/google-oauth-verification-security-assessment/)
- [Recording Law — 2-party consent states](https://www.recordinglaw.com/party-two-party-consent-states/)
