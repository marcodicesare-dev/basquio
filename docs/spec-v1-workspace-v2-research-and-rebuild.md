# V1 Workspace V2 — Research mandate + rebuild spec

**Status:** the V1 shipped in `446a518..fb43b15` is a correct schema wearing the wrong product skin. Two audits on 2026-04-19 converged. This document locks the merged findings, mandates a deep research phase before code, then specifies the IA and architecture rebuild.

**Rule for this agent:** do not write code until the Research Phase deliverable (a single markdown memo) is committed to `docs/` and Marco has approved it. Any code before that approval is a violation of working rules §2.

Canonical references (read in this order):
1. `docs/working-rules.md`
2. `docs/2026-04-19-v1-workspace-audit.md` (prior agent)
3. `docs/2026-04-19-strategic-validation.md` (prior agent)
4. `docs/strategy-basquio-motions.md`
5. `docs/motion2-workspace-architecture.md`
6. `docs/spec-v1-workspace.md`
7. `docs/design-tokens.md`

---

## 1. The merged finding from two audits

Both audit passes converged on the same verdict: **the database is right, the product skin is wrong.**

Specifically:
- Memory and per-scope architecture shipped correctly in the schema.
- Anthropic Memory Tool wired correctly in the generation path.
- Seed data is realistic enough to demo.
- Team-beta gate is correct and reuses existing helper.

But:
- The UX communicates "a better chat + file upload tool," not "the workspace where your analyst memory lives."
- Scope is a dropdown inside the prompt, not the navigation spine.
- Memory exists in Postgres but is invisible and uneditable in the UI.
- Stakeholder profiles, per-client rules, and procedural preferences are data the schema holds and the UI discards.
- Onboarding is a single empty state. No guided setup that seeds the workspace with client scopes, stakeholder profiles, and style rules.
- Entity resolution is exact + LLM tiebreak only. Precision on real Italian CPG names is likely under 85%, which makes memory feel dumb within the first 10 interactions.
- Positioning copy on the workspace home reads as generic AI, not as CPG-specialized memory.
- Workspace ID is a singleton constant (`BASQUIO_TEAM_ORG_ID`). No workspace-template concept, which blocks the demo-workspace outreach motion (BAS-174).
- Provenance is computed at generation time, stored in `workspace_deliverables.metadata`, and never rendered to the user.
- Current streaming is a hand-rolled `fetch + ReadableStream` loop in `workspace-prompt.tsx`. No tool call rendering, no reasoning tokens, no generative UI. This is the 2024 pattern. The 2026 pattern is Vercel AI SDK v6 with `useChat` + `tool()` + message parts.

Plus one strategic sharpening from the validation memo: **"we have memory" is commoditizing.** Anthropic Memory Tool is a public primitive, ChatGPT has cross-conversation memory, Claude Projects has project memory. The defensible bundle is:
- CPG-domain schema (what an entity is, what a fact predicates over, what a stakeholder preference looks like)
- Cross-source assembly (NIQ + Kantar + retailer 1P + internal briefs + meeting transcripts + agency deliverables, unified)
- Compounding procedural memory per-analyst
- Bi-temporal grounding (event time vs ingestion time, superseded facts)

If a prospect summarizes the pitch as "Basquio remembers things," we lost. If they summarize it as "Basquio knows my KPI dictionary, my stakeholders, my editorial conventions, and the last 3 category reviews I ran," we won.

---

## 2. Research phase (mandatory, no code until memo is committed)

Produce a single markdown memo at `docs/2026-04-20-workspace-v2-research.md` covering the six topics below. Every claim sourced with a live URL. No fabrication. No pattern-matching to plausible answers. If a topic has no clear 2026 answer, flag UNVERIFIED explicitly.

### Topic 1 — Vercel AI SDK current version, chat patterns, generative UI

Canonical docs: https://ai-sdk.dev/llms.txt (full documentation in Markdown, paste into context)

Questions the memo must answer:
- What is the current stable major version of the Vercel AI SDK as of 2026-04-20? (Check https://ai-sdk.dev/docs and npm for exact semver)
- `useChat` hook: current API shape, message parts, tool call rendering, streaming protocols
- `streamText` vs `streamObject` vs `generateText` vs `generateObject`: when each is appropriate for the Basquio workspace
- Tool calls with streaming: how to render a tool call as it executes (for "Basquio is reading your Q3 deck…" status visual)
- Generative UI: rendering React components inline in an assistant response based on tool results
- Reasoning tokens: how to display Claude's thinking stream alongside the final answer
- Multi-modal parts in messages: how to mix text, citations, images, tool result cards in a single response
- Interop with Anthropic Claude provider specifically (not just OpenAI): any quirks, beta headers required, memory tool compatibility

Reference implementation to study: `/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/app/api/views` and related AI SDK usage in Marco's rabbhole project. Read the actual patterns, not reinvent.

Deliverable section: decide whether to migrate `workspace-prompt.tsx` from custom streaming to AI SDK v6 `useChat`. Default recommendation: yes, because generative UI + tool rendering + reasoning tokens are standard table stakes in 2026 chat UX and hand-rolling them is a waste of Marco's time.

### Topic 2 — Legora and Harvey chat/workspace UX teardown

Marco has access to Legora demos via search, and Harvey has a public product tour. Use Firecrawl (`firecrawl scrape`) to pull their live product pages, marketing screenshots, and any public video teardowns. If you find Loom/YouTube product tours, transcribe key UX patterns.

Questions the memo must answer:
- How does Legora present "the matter" as a navigation container? Is it a left rail, a top tab, a command-palette destination?
- How does Harvey's Assistant differentiate from ChatGPT in the chat surface? What visible cues signal "this is legal, not generic"?
- How do both products surface memory at chat time? A panel? An inline list? A hover reveal?
- Entity-linking pattern: when a lawyer name or case citation appears in an answer, is it hyperlinked, hovered, or inline-expanded?
- How do they handle the "which scope am I in" problem? How does a user switch scope without losing context?
- Command palette: do they use one? What's in it?
- Suggestions / next-actions: do they show proactive suggestions? Where?

Sources to pull:
- https://legora.com/
- https://legora.com/product (any subpages)
- https://harvey.ai/
- https://harvey.ai/products (Assistant, Vault, Knowledge, Workflow Agents)
- Any Artificial Lawyer / LawSites writeups with screenshots
- Any YouTube product tours (use Firecrawl agent to search, then scrape transcripts)

Deliverable section: a list of 10-15 concrete UX patterns to adopt, with source URL for each.

### Topic 3 — Memory UI patterns from Mem, Reflect, Tana, Granola, Claude Projects

Different products take different positions on "how visible should memory be." Audit the spectrum:

- **Mem.ai**: fully visible memory graph, user can browse their own knowledge
- **Reflect / Tana**: outlined memory with backlinks, user-curated structure
- **Granola Spaces**: per-space memory, user configures scope membership
- **Claude Projects**: project-scoped memory, minimal user-facing browse surface
- **ChatGPT Memory**: single global memory list with edit/delete, shown in settings

Questions:
- Which products let the user edit memory directly? How?
- Which show memory inline during a chat turn? How?
- Which force memory to feel automatic vs manual?
- What's the failure mode if memory gets noisy (wrong, duplicate, stale)?

Sources: product pages, help docs, YouTube tours. Use Firecrawl.

Deliverable section: a matrix of memory visibility patterns with trade-offs, and an opinionated recommendation for Basquio (somewhere between Mem.ai and Claude Projects).

### Topic 4 — Chat-in-scope / scope-as-navigation patterns

Questions:
- How does Linear treat projects vs workspaces? How does the left rail communicate scope?
- How does Cursor treat codebases vs chats? Chat-per-folder patterns.
- How does Notion handle per-page AI vs workspace AI?
- Is there a verified pattern for "you're inside Client:Lavazza, the AI only sees Lavazza context" that we can model?

Deliverable section: the navigation IA (left rail structure, top bar, scope switcher UX).

### Topic 5 — Vercel AI SDK in rabbhole (Marco's pattern reference)

Path: `/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/app/api/views` and related files. Read the actual implementation. Not as source of truth for Basquio, but as reference for what Marco has already done and likely wants to reuse.

Questions:
- What version of AI SDK is used?
- How are tools defined, executed, streamed?
- How is the UI wired (useChat vs streamText vs custom)?
- What patterns from rabbhole are worth copying verbatim vs rethinking for Basquio's CPG domain?

Deliverable section: explicit "copy from rabbhole" list vs "different for Basquio because" list.

### Topic 6 — Entity resolution quality at production scale

Current V1 does exact + LLM tiebreak. Test hypothesis: this generates >15% error rate on Italian CPG entity names ("Mulino Bianco" vs "Barilla" vs "Barilla Group" vs "Barilla Holding", "Elena Passoni Barilla" vs "Elena Passoni Mulino Bianco", "Lavazza" vs "Luigi Lavazza S.p.A.").

Run the test: generate a 500-row Italian CPG test corpus from the seeded demo workspace + 2-3 real briefs. Measure precision (correct match / total matches) and recall (found entities / total entities).

Sources for 2026-current entity resolution practice:
- https://senzing.com/entity-resolved-knowledge-graphs/
- https://microsoft.github.io/graphrag/ (entity/relationship extraction + community detection)
- https://neo4j.com/blog/developer/llm-knowledge-graph-builder-release/
- https://github.com/mem0ai/mem0 (Mem0g graph + entity resolution)
- https://github.com/getzep/graphiti (bi-temporal KG with entity resolution)

Deliverable section: current precision/recall numbers and a 1-week plan to reach >90% precision. Recommendation: add phonetic (Soundex for Italian), embedding-based similarity, and LLM tiebreak only on ambiguous collisions. Do not migrate to Graphiti in V2 unless precision stays under 85% after the cascade upgrade.

---

## 3. IA decisions locked (input to research, not debated)

These are decisions Marco has already made. Research confirms implementation details; do not revisit the decisions themselves.

### Decision 1: Scope is the navigation spine, not a dropdown

Left rail structure:
```
Basquio Workspace
├── Home
├── Clients
│   ├── Lavazza
│   ├── Mulino Bianco
│   └── [+ add client]
├── Categories
│   ├── Snack Salati
│   ├── Pasta
│   └── [+ add category]
├── Functions (for internal analyst like Veronica)
│   ├── Executive reviews
│   └── [+ add function]
├── People
│   └── (stakeholders grouped by scope)
└── Memory
    ├── Rules
    ├── Style guide
    └── Glossary
```

Entering a scope sets the working context. All prompts, all retrieved memory, all generated deliverables default to that scope unless the user explicitly overrides. Visual cue: breadcrumb + scope chip at top of main area ("Working in: Clients / Lavazza").

### Decision 2: Memory is browseable and editable

Memory tab in the left rail shows all memory entries grouped by scope and type (semantic / episodic / procedural). User can:
- Read any memory entry
- Edit the content inline
- Delete with confirmation
- Add a new memory directly ("teach Basquio a rule")
- Pin or archive

This makes memory a first-class object, not a black box. Trust is earned when the user can see what the AI "knows" and correct it.

### Decision 3: Stakeholder profiles are first-class pages

Every person entity has a profile page. Profile fields:
- Name, role, company, reporting scope
- Preferences (editable free-text + structured: "prefers waterfall over bar charts", "presents in English", "responds well to Q4 framing")
- Recent mentions (auto-populated from entity_mentions)
- Linked deliverables (where this person appears)
- Notes (free-text analyst notes)

Referenced in chat: when an analyst asks "draft a one-pager for Elena Passoni," Basquio pulls Elena's profile preferences automatically.

### Decision 4: Onboarding is a 4-step guided setup

First-time workspace entry shows a guided flow, not an empty state:

1. **What's your role?** (Internal analyst / agency consultant / trade marketing / other) → seeds the analyst-scope procedural memory
2. **Who are your main clients or categories?** (free-text entry → creates scope sub-workspaces) → seeds Client/Category scopes
3. **Who are your key stakeholders?** (per scope, name + role + 1-line preference) → seeds Person entities with preferences
4. **Upload 1-3 prior artifacts** (per scope) → seeds memory from real content

Skippable, but strongly encouraged. First run shows the empty scope tree populated with the user's actual working world. Workspace is useful on first generation, not on 10th.

### Decision 5: Provenance panel on every answer

Every generated deliverable shows, inline:
- "This answer used X facts, Y memory entries, Z source excerpts"
- Click expands a side panel showing each source with link to the original document/transcript/fact
- Each fact shows `valid_from` and the source that taught it to Basquio

This is the "why should I trust this?" reassurance. Mandatory for B2B buyers.

### Decision 6: Positioning copy

Hero (workspace home, not visible until onboarding is complete): *"Your analyst memory, always there."*

Sub-hero: *"Basquio knows your clients, stakeholders, and style. Ask a question, get the answer your client expects. Every answer cites where it came from."*

Not "Drop a file. Ask anything." Not "Beautiful intelligence." Not "AI for analysts."

If a prospect summarizes the pitch as "Basquio remembers things," fail. If they summarize as "Basquio knows my clients and does my work in my style," win.

### Decision 7: Workspace template vs instance (BAS-174 unlock)

Current: `BASQUIO_TEAM_ORG_ID` is a constant. Every user is conceptually in the same workspace.

Required: promote to a real `workspaces` table with:
- `id`, `name`, `slug`
- `kind`: enum(`team_beta`, `demo_template`, `customer`)
- `template_id` (nullable, references another workspace row)
- `visibility`: enum(`private`, `team`, `shareable_with_token`)
- Created by, created at

Then a demo-template workspace (`Basquio Demo: Mulino Bianco`) can be cloned for each outreach prospect. Prospect signs up, workspace gets cloned from template, prospect sees a pre-populated workspace that feels like their business (client scopes, stakeholders, style rules all seeded).

### Decision 8: Workspace → deck pipeline bridge (BAS-175 unlock)

Every workspace deliverable (a memo or an answer) gets a "Generate deck" button. Clicking hands the deliverable + cited sources + workspace context to the existing Inngest deck pipeline. The pipeline produces a PPTX using the existing slide generation engine, scoped to the workspace template.

No duplicate product. One workspace. One memory. Two output types (memo, deck).

---

## 4. Architectural changes required

### 4a. Workspaces table (new)

```sql
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,  -- future: per-tenant isolation
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('team_beta', 'demo_template', 'customer')),
  template_id UUID REFERENCES public.workspaces(id),
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'team', 'shareable_with_token')),
  share_token TEXT UNIQUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
```

Migrate existing seeded data to a single `workspaces` row (`kind='team_beta'`, `organization_id=BASQUIO_TEAM_ORG_ID`). Add `workspace_id` foreign key to all scoped tables (`knowledge_documents`, `entities`, `entity_mentions`, `facts`, `memory_entries`, `workspace_deliverables`). Backfill all rows with the team-beta workspace id.

All queries in `apps/web/src/lib/workspace/db.ts` switch from `organization_id = BASQUIO_TEAM_ORG_ID` to `workspace_id = $currentWorkspaceId`.

### 4b. Scopes registry (new)

```sql
CREATE TABLE IF NOT EXISTS public.workspace_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('client', 'category', 'function', 'system')),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  parent_scope_id UUID REFERENCES public.workspace_scopes(id),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, slug)
);
```

Seeds: every workspace gets a `system.analyst` scope, a `system.workspace` scope. Clients, categories, functions are user-created.

Change `memory_entries.scope`, `workspace_deliverables.scope`, `facts.scope` from free-text strings to `workspace_scope_id` foreign keys.

### 4c. Stakeholder preferences (extension of entities)

Entities table already has `metadata JSONB`. For `type='person'`, the metadata convention locks to:
```json
{
  "role": "Head of Category",
  "company": "Lavazza",
  "preferences": {
    "free_text": "Prefers waterfall charts. Responds well to Q4 framing. Presents in English.",
    "structured": {
      "chart_preference": "waterfall",
      "deck_length": "short",
      "language": "en",
      "tone": "executive"
    }
  },
  "linked_scope_id": "uuid",
  "notes": "Analyst notes here."
}
```

New API route `/api/workspace/people/[id]` supports GET and PATCH for the profile surface.

### 4d. Memory browse surface

New API route `/api/workspace/memory` returns all memory entries for the current workspace grouped by scope and type. `PATCH` supports inline edit. `DELETE` supports removal. `POST` supports user-created memory.

### 4e. Provenance ledger

Deliverable `metadata` JSONB stores an explicit `sources` array:
```json
{
  "sources": [
    {"type": "fact", "id": "uuid", "label": "Lavazza 52-week share = 14.2%", "valid_from": "2025-09-01", "source_document_id": "uuid"},
    {"type": "memory", "id": "uuid", "scope": "client:Lavazza", "memory_type": "procedural", "content": "Client prefers waterfall over bar"},
    {"type": "document_excerpt", "document_id": "uuid", "page_number": 3, "excerpt": "Q3 share stable at 14.2%..."}
  ]
}
```

Workspace deliverable UI renders this as a Provenance panel with click-through to each source.

### 4f. Entity resolution cascade upgrade

Per Topic 6 research: upgrade from `exact + LLM tiebreak` to `exact → normalized → phonetic (Italian Soundex) → embedding similarity → LLM tiebreak on ambiguous only`.

Implementation: extend `apps/web/src/lib/workspace/extraction.ts` with a `resolveEntity(candidate, existingEntities)` function. Measure precision on the 500-row test corpus. Ship when precision >90%.

---

## 5. UX and UI rigor

### Migration: custom streaming → Vercel AI SDK v6 `useChat`

Current `workspace-prompt.tsx` has a hand-rolled ReadableStream reader with custom event parsing. Replace with the AI SDK v6 `useChat` hook. Benefits:
- Tool call streaming and rendering (for status "Basquio is reading your Q3 deck..." visible as tool execution)
- Reasoning tokens display (when Claude thinks, show the thinking stream collapsed-by-default)
- Message parts (mix text + citations + tool result cards in a single response)
- Native Anthropic Claude provider support
- Standard patterns for stop / retry / regenerate

Spec this migration in the research memo. Identify the exact AI SDK v6 version to use. Reference rabbhole patterns.

### Chat surface lives inside a scope

When the user is inside "Clients / Lavazza", the chat surface is explicitly "Lavazza chat". Header shows breadcrumb. Prompt placeholder changes per scope: "Ask about Lavazza..." Default retrieval is scoped. Manual override available via scope chip in the input.

When the user is at "Home," the prompt placeholder is "Ask anything across your workspace" and retrieval spans all scopes.

### Tool call rendering for memory consultation

When a generation triggers a memory lookup, the UI shows an inline tool card:
```
🧠 Reading your workspace memory
   ↳ Lavazza scope: 12 facts, 4 style rules, 3 stakeholders
   ↳ Analyst scope: 2 procedural preferences
```

This surfaces the invisible differentiation. Users SEE that the AI is consulting memory.

### Command palette (Cmd+K)

Primary navigation. Destinations:
- Any scope
- Any stakeholder
- Any memory entry
- Any recent deliverable
- "Ask {scope}: ..." (inline query)
- "Teach {scope}: ..." (add memory)
- "Upload to {scope}..."

AI SDK v6 + fuzzy search over the entity and memory registries.

### Sub-50ms optimistic UI

Every memory edit, entity update, scope creation writes optimistically. UI reflects change immediately. Network confirms async. Failure surfaces as a toast, not a page reload. Non-negotiable per working rules §7.

### 2k-euro-per-hour design bar

Every screen passes the test: would a senior design studio ship this?
- Golden-ratio split (1 : 1.618)
- Fibonacci spacing (4, 8, 13, 21, 34, 55, 89)
- Modular type scale 1.25 (13, 16, 20, 25, 32, 40, 50, 64)
- Tokens from `docs/design-tokens.md` only
- Sentence-case, human-crafted copy per working rules §4, §5
- Every state (empty, loading, error, success) designed to the same bar

Additional rigor: every empty state must have one primary action button and one sentence of teaching copy, not three paragraphs of feature explanation.

---

## 6. What NOT to touch

These are correct in the current V1. Do not rework.

- Database schema for `knowledge_documents`, `entities`, `entity_mentions`, `facts`, `memory_entries`, `workspace_deliverables`. Only add the new `workspaces` and `workspace_scopes` tables.
- Team-beta gate (`isTeamBetaEligible`). Correct implementation, keep.
- Seed data for marco@basquio.com (the 90-day Mulino Bianco / Snack Salati fixture). Use as the default test and demo workspace.
- Existing Inngest deck pipeline. Do not rewrite. Add a bridge from workspace deliverables into it.
- Anthropic Memory Tool integration. Correct, keep.
- Hybrid search RPC. Correct, extend with workspace_id + scope_id filters.
- Stripe billing. Not touched yet. Leave for Motion 2 pricing decision.
- Trust/privacy page at `/trust`. Do not touch. Add an inline reference from the workspace ("Your data stays in your workspace. Privacy posture →").

## 7. Acceptance criteria for V2

1. Research memo at `docs/2026-04-20-workspace-v2-research.md` committed to main, Marco-approved.
2. Workspaces table + workspace_scopes table shipped. All existing seed data migrated cleanly.
3. Scope as left-rail navigation. User can enter a scope and work in it. Breadcrumb visible.
4. Memory browse + edit + add surface live. User can see every memory entry for the current scope and edit it.
5. Stakeholder profile pages live. Every Person entity has a profile with editable preferences.
6. Onboarding 4-step flow shipped. Skippable. New user lands on a populated scope tree after completing.
7. Provenance panel rendered inline on every deliverable.
8. Hero copy changed to "Your analyst memory, always there."
9. Workspace template concept shipped (`kind='demo_template'`). One demo workspace seeded, cloneable via API.
10. Workspace → deck bridge shipped. "Generate deck" button on every deliverable.
11. Entity resolution precision >90% on the 500-row Italian CPG test corpus.
12. Command palette (Cmd+K) shipped with scope + stakeholder + memory + deliverable search.
13. AI SDK v6 `useChat` migrated (or explicit research memo documenting why not).
14. Tool call rendering for memory consultation visible at generation time.
15. All 262 `.wbeta-*` CSS classes pass the 2k-euro bar audit. Empty states, loading states, error states all pass.

No commits toward these until research memo is merged to main and Marco has approved.

---

## 8. Appendix: Outreach target list (Motion 1 / BAS-174 demo-workspace candidates)

Data source: `/Users/marcodicesare/Desktop/enriched-fra-contacts.csv` filtered to: Italian mid-market CPG, signal score 8+, target role (Marketing/Brand/Category/Insight/Trade Manager/Director/Head level), recent movers prioritized (3× more likely to adopt new tools).

Filter result: 121 hot leads across 40+ Italian CPG companies. 47 are movers. The top 10 by ICP fit, for the demo-workspace outreach:

| Rank | Name | Title | Company | Why prioritize | Email |
|---|---|---|---|---|---|
| 1 | Valentina Fioretti | Consumer & Market Intelligence Manager | Amadori | Perfect ICP title, mover, mid-market leader in poultry | valentina.fioretti@amadori.it |
| 2 | Laura Romoli | Head of Consumer Insight & Business Intelligence | illycaffè | Perfect ICP title, mover, Italian global brand | laura.romoli@illy.com |
| 3 | Stefania Rinelli | Senior Director Consumer Insights — Consumer Healthcare | Haleon (ex-Alfasigma) | Senior Director title, mover, healthcare consumer adjacent | stefania.x.rinelli@haleon.com |
| 4 | Matteo Conti | Central Strategic Marketing Director | Amadori | Director, mover, companion to #1 at same company | matteo.conti@amadori.it |
| 5 | Alessandra Princi | Head of Trade Marketing & Sell Out | GranTerre | Head level, mover, dairy mid-market | alessandra.princi@granterre.it |
| 6 | Marika Brauner | Marketing Manager Italia | GranTerre | Mover, companion to #5 at same company | marika.brauner@granterre.it |
| 7 | Alessio Sestini | Head of Trade Marketing Food | Gruppo Montenegro | Head level, mover, beverages mid-market | alessio.sestini@montenegro.it |
| 8 | Alessandra Merola | Marketing & Communication Manager | Alce Nero | Mover, organic food mid-market, values-driven brand (easier pitch) | a.merola@alcenero.it |
| 9 | Gianluca Puttini | Marketing e Trade Marketing Manager | Alce Nero | Mover, companion to #8 at same company | g.puttini@alcenero.it |
| 10 | Francesco Fabbro | Category Management Manager Pasta & Condiments | Barilla Group | Mover, specific category ownership (pasta = demo-friendly scope), larger company stretch | francesco.fabbro@barilla.com |

### Outreach sequencing recommendation

**Week 1 (5 outreaches):** Amadori, illycaffè, GranTerre, Alce Nero, Gruppo Montenegro. All Italian mid-market, all have 2+ relevant contacts per company (cross-target strategy), all in the €100M-€1B revenue band where a Head/Director signs €500-1000/mo without procurement escalation.

**Week 2 (5 outreaches):** Haleon, Barilla (Fabbro only, narrow category scope), plus 3 from the second tier (Loacker, Colussi, Sperlari).

**Week 3 (stretch):** revisit Rovagnati, Citterio, Sunstar if Week 1 needs refill.

### Pre-outreach prerequisites

Per the strategic validation memo, do not send any of these before:
1. Positioning one-liner is rewritten (working rules §5 compliant)
2. Privacy one-pager is drafted (bilingual IT/EN, 2 pages max)
3. Demo workspace for one named prospect is pre-seeded (choose the first prospect, seed their sector: Amadori = poultry, illycaffè = coffee, GranTerre = dairy)
4. V2 workspace is live in team-beta (so the prospect sees the finished UX, not V1)

These four prerequisites should land in the 48-hour window the strategic validation memo proposed. Outreach starts Week 1 of the new spec, not before.

### Contact owner notes

- `contact_owner` column in the CSV maps each lead to a co-founder (Ale, Fra, Rossella). Warm intros route via that owner. No cold email.
- `has_recent_activity = true` contacts are more responsive on LinkedIn than email. Ale sends via LinkedIn DM. Prompt template per working rules §5 (short, human, FMCG-specific pain reference, no AI slop).

---

## 9. Flip-flop prevention

This spec is v1. If the research memo surfaces findings that materially change decisions 1-8 in §3, the agent must:
1. Surface the finding explicitly
2. Name the decision being challenged
3. Wait for Marco to approve the change

Do not silently drift from the decisions. Working rules §12 applies.
